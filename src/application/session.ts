import { DateTime } from 'luxon'
import {
  newId,
  canonical,
  transactionSchema,
  type Account,
  type Draft,
  type Operation,
  type Command,
  type Transaction,
} from '../domain/model'
import { project, draftHeads, validateAccount, validateTransaction } from '../domain/ledger'
import type { CloudPort } from '../infrastructure/drive'
import type { LocalRepository } from '../infrastructure/local'

export type Lock = <T>(action: () => Promise<T>) => Promise<T>
export class LedgerSession {
  operations: Operation[] = []
  cloudDrafts: Draft[] = []
  lastSyncedAt = ''
  private tail: Promise<unknown> = Promise.resolve()
  private uploadingRevisions = new Set<string>()
  constructor(
    readonly cloud: CloudPort,
    readonly local: LocalRepository,
    private readonly lock: Lock,
    private readonly signal: AbortSignal,
    private readonly now = () => new Date().toISOString(),
  ) {}
  get ledger() {
    return project(this.operations)
  }
  get drafts() {
    return draftHeads([...this.cloudDrafts, ...this.local.drafts()])
  }
  get pending() {
    return this.local.pending()
  }
  private alive() {
    if (this.signal.aborted) throw new DOMException('工作階段已結束', 'AbortError')
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail
      .catch(() => undefined)
      .then(() =>
        this.lock(async () => {
          this.alive()
          return action()
        }),
      )
    this.tail = next
    return next
  }
  private async pull() {
    this.alive()
    await this.cloud.checkBinding()
    const ops = await this.cloud.readOperations()
    const drafts = await this.cloud.readDrafts()
    this.alive()
    project(ops) // Reject unreadable data before replacing the last verified view.
    draftHeads([...drafts, ...this.local.drafts()])
    this.operations = ops
    this.cloudDrafts = drafts
    this.lastSyncedAt = this.now()
    this.local.cache(this.cloud.book, ops)
  }
  sync() {
    return this.exclusive(async () => {
      await this.pull()
      for (const pending of this.local.pending()) {
        if (
          this.operations.some((op) => op.id === pending.id && canonical(op) === canonical(pending))
        )
          this.local.removePending(pending.id)
      }
      for (const draft of this.local.drafts()) {
        if (!this.local.isDraftSynced(draft)) {
          this.uploadingRevisions.add(draft.revisionId)
          try {
            await this.cloud.writeDraft(draft)
            this.alive()
            this.local.acknowledgeDraft(draft)
          } finally {
            this.uploadingRevisions.delete(draft.revisionId)
          }
        }
      }
      if (this.local.drafts().length) {
        this.cloudDrafts = await this.cloud.readDrafts()
        this.alive()
      }
    })
  }
  saveDraft(value: Transaction, discard = false, parents?: string[]) {
    this.alive()
    const local = this.local.drafts().find((d) => d.id === value.id)
    const heads = this.drafts.filter((d) => d.id === value.id)
    if (
      this.local
        .pending()
        .some(
          (op) => op.command.type === 'transaction.post' && op.command.transaction.id === value.id,
        )
    ) {
      const previous = local ?? heads[0]
      if (previous && !discard && canonical(previous.value) === canonical(value)) return previous
      throw new Error('這份草稿已有待確認提交，請先查回結果；要修改內容可複製為新草稿')
    }
    const draft: Draft = {
      format: 'choubo.draft',
      schemaVersion: 1,
      ownerId: this.cloud.book.ownerId,
      bookId: this.cloud.book.id,
      id: value.id,
      revisionId: newId(),
      parents:
        parents ??
        (local
          ? this.local.isDraftSynced(local)
            ? [local.revisionId]
            : [
                ...local.parents,
                ...(this.uploadingRevisions.has(local.revisionId) ? [local.revisionId] : []),
              ]
          : heads.length === 1
            ? [heads[0].revisionId]
            : []),
      updatedAt: this.now(),
      discarded: discard,
      value: transactionSchema.parse(value),
    }
    this.local.saveDraft(draft)
    return draft
  }
  private operation(command: Command, id: string = newId()): Operation {
    return {
      format: 'choubo.operation',
      schemaVersion: 1,
      ownerId: this.cloud.book.ownerId,
      bookId: this.cloud.book.id,
      id,
      createdAt: this.now(),
      command,
    }
  }
  private async commit(operation: Operation) {
    this.alive()
    if (operation.command.type === 'transaction.post') {
      const command = operation.command
      if (
        command.dependencies.some(
          (d) => this.ledger.accounts.find((a) => a.id === d.accountId)?.versionId !== d.versionId,
        )
      )
        throw new Error('帳戶設定已變更，請核對待提交內容；不會自動套用舊設定')
    }
    const candidate = project([...this.operations, operation])
    if (candidate.conflicts.some((c) => c.operationIds.includes(operation.id)))
      throw new Error('這項操作與雲端版本衝突，請先重新同步並核對')
    this.local.savePending(operation)
    await this.cloud.writeOperation(operation)
    this.alive()
    await this.pull()
    if (
      !this.operations.some(
        (op) => op.id === operation.id && canonical(op) === canonical(operation),
      )
    )
      throw new Error('尚未查回正式保存結果，請保留待確認項目後重試')
    if (this.ledger.conflicts.some((c) => c.operationIds.includes(operation.id)))
      throw new Error('雲端保存後發現並發衝突，相關紀錄暫停入帳')
    this.local.removePending(operation.id)
  }
  saveAccount(account: Account, baseVersionId: string | null) {
    return this.exclusive(async () => {
      await this.pull()
      const current = this.ledger.accounts.find((a) => a.id === account.id)
      if ((current?.versionId ?? null) !== baseVersionId)
        throw new Error('帳戶已在另一處修改，請重新開啟帳戶設定')
      await this.commit(
        this.operation({ type: 'account.put', baseVersionId, account: validateAccount(account) }),
      )
    })
  }
  setDefault(accountId: string) {
    return this.exclusive(async () => {
      await this.pull()
      if (!this.ledger.accounts.some((a) => a.id === accountId && !a.archived))
        throw new Error('請選擇可使用的帳戶')
      await this.commit(
        this.operation({
          type: 'book.default-account',
          accountId,
          baseVersionId: this.ledger.defaultVersionId,
        }),
      )
    })
  }
  postDraft(id: string) {
    return this.exclusive(async () => {
      await this.pull()
      const operationId = `transaction:${id}`
      const known = this.operations.filter(
        (op) => op.command.type === 'transaction.post' && op.command.transaction.id === id,
      )
      if (known.length) {
        if (this.ledger.conflicts.some((c) => c.id === id || c.id === operationId))
          throw new Error('這份草稿有提交衝突，請先核對')
        throw new Error('這份草稿已提交過，請查看紀錄；要再次記帳請複製為新草稿')
      }
      const pending = this.local.pending().find((op) => op.id === operationId)
      if (pending) {
        await this.commit(pending)
        this.local.removeDraft(id)
        return
      }
      const drafts = this.drafts.filter((d) => d.id === id)
      if (drafts.length !== 1) throw new Error('草稿有多個版本，請先選擇要保留的內容')
      const draft = drafts[0]
      if (draft.discarded) throw new Error('這份草稿已捨棄')
      const transaction = validateTransaction(
        draft.value,
        this.ledger.accounts,
        DateTime.fromISO(this.now()).setZone('Asia/Taipei'),
      )
      const ids = [
        transaction.accountId,
        ...(transaction.kind === 'transfer' ? [transaction.targetAccountId] : []),
      ]
      const dependencies = ids.map((accountId) => ({
        accountId,
        versionId: this.ledger.accounts.find((a) => a.id === accountId)!.versionId,
      }))
      await this.commit(
        this.operation({ type: 'transaction.post', transaction, dependencies }, operationId),
      )
      this.local.removeDraft(id)
    })
  }
  retry(id: string) {
    return this.exclusive(async () => {
      await this.pull()
      const op = this.local.pending().find((o) => o.id === id)
      if (!op) return
      if (this.operations.some((o) => canonical(o) === canonical(op))) {
        this.local.removePending(id)
        return
      }
      // Revalidation by projection prevents writing stale account revisions.
      await this.commit(op)
      if (op.command.type === 'transaction.post') this.local.removeDraft(op.command.transaction.id)
    })
  }
  reverse(transactionId: string, reason: string) {
    return this.exclusive(async () => {
      await this.pull()
      if (!this.ledger.transactions.some((t) => t.id === transactionId))
        throw new Error('找不到原紀錄')
      if (this.ledger.reversed.includes(transactionId)) return
      const pending = this.local.pending().find((op) => op.id === `reverse:${transactionId}`)
      await this.commit(
        pending ??
          this.operation(
            { type: 'transaction.reverse', transactionId, reason },
            `reverse:${transactionId}`,
          ),
      )
    })
  }
}
