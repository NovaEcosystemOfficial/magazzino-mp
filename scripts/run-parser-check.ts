import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { parseDdtFromTextItems } from '../src/ddt/parseDdt.ts'

async function main() {
  const data = new Uint8Array(readFileSync('fixtures/marina-raphael.pdf'))
  const doc = await getDocument({ data, useSystemFonts: true }).promise
  const items: {
    str: string
    x: number
    y: number
    width: number
    height: number
  }[] = []

  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    for (const raw of content.items) {
      if (!('str' in raw) || typeof raw.str !== 'string') {
        continue
      }
      items.push({
        str: raw.str,
        x: Number(raw.transform[4]),
        y: Number(raw.transform[5]),
        width: typeof raw.width === 'number' ? raw.width : 0,
        height: typeof raw.height === 'number' ? raw.height : 0,
      })
    }
  }
  const parsed = parseDdtFromTextItems(items)
  console.log(
    JSON.stringify(
      {
        header: parsed.header,
        lines: parsed.lines.map((line) => ({
          n: line.lineNumber,
          desc: line.description,
          code: line.articleCodeCandidate,
          qty: line.quantity,
          warnings: line.warnings,
        })),
        warnings: parsed.warnings,
      },
      null,
      2,
    ),
  )

  const ok =
    parsed.header.documentNumber === '798VEND' &&
    parsed.header.documentDate === '02/10/2026' &&
    /LES BIJOUX/i.test(parsed.header.supplier) &&
    parsed.lines.length === 2 &&
    parsed.lines[0]?.quantity === 6 &&
    /oro/i.test(parsed.lines[0]?.description ?? '') &&
    parsed.lines[1]?.quantity === 11 &&
    /gunmetal/i.test(parsed.lines[1]?.description ?? '')

  console.log(ok ? 'PARSER_OK' : 'PARSER_FAIL')
  process.exit(ok ? 0 : 1)
}

void main()
