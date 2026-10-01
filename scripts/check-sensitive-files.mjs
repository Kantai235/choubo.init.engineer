import process from 'node:process'
import console from 'node:console'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

const staged = process.argv.includes('--staged')
const args = staged
  ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
  : ['ls-files', '-z']
const files = execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean)
const issues = []
const sensitivePath =
  /(^|\/)(?:\.env(?:\..+)?|\.npmrc|\.pnpmrc|credentials[^/]*\.json|client_secret[^/]*\.json|service-account[^/]*\.json|application_default_credentials\.json|choubo-(?:export|draft)-[^/]*\.json)$|\.(?:pem|key|p12|pfx)$/i
const privateDirectory =
  /(^|\/)(?:node_modules|dist|work|test-results|playwright-report|coverage)\//
const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['google-access-token', /ya29\.[A-Za-z0-9._-]{25,}/],
  ['google-client-secret', /GOCSPX-[A-Za-z0-9_-]{20,}/],
  ['github-token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})/],
  ['aws-access-key', /(?:AKIA|ASIA)[A-Z0-9]{16}/],
  ['service-account-key', /"type"\s*:\s*"service_account"/],
  ['private-page-reference', /https:\/\/chatgpt\.com\/space\/page_[a-f0-9]+/],
]
for (const file of files) {
  if ((sensitivePath.test(file) && file !== '.env.example') || privateDirectory.test(file))
    issues.push(`${file}: sensitive file path`)
  let content
  if (staged)
    content = execFileSync('git', ['show', `:${file}`], { maxBuffer: 20 * 1024 * 1024 }).toString(
      'utf8',
    )
  else {
    if (!statSync(file).isFile()) continue
    content = readFileSync(file, 'utf8')
  }
  for (const [name, pattern] of patterns) if (pattern.test(content)) issues.push(`${file}: ${name}`)
}
if (issues.length) {
  console.error(issues.join('\n'))
  process.exit(1)
}
console.log(
  `Checked ${files.length} tracked files: no prohibited paths or credential patterns found.`,
)
