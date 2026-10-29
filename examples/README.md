# Example

```sh
mkdir demo && cd demo && npm init -y && npm install express
WT_INGEST_KEY=wti_your_key npx @watchtowerobservability/wizard --dry-run   # review the diff
npx @watchtowerobservability/wizard                                        # then apply it
npx @watchtowerobservability/wizard verify
```

`test/wizard.test.js` builds fixture projects for every supported stack and is the runnable reference.
