import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { pdf } from 'pdf-to-img'

const PARSE_URL =
  'https://ai.api.nvidia.com/v1/retrieval/nvidia/nemotron-3.5-parse/parse'

const State = Annotation.Root({
  image: Annotation<Buffer>(),
  date: Annotation<string | null>(),
})

const parse = async (state: typeof State.State) => {
  const apiKey = process.env.NVIDIA_API_KEY
  if (!apiKey) throw new Error('NVIDIA_API_KEY is not set')

  const bytes = state.image.buffer.slice(
    state.image.byteOffset,
    state.image.byteOffset + state.image.byteLength,
  ) as ArrayBuffer

  const form = new FormData()
  form.append(
    'document',
    new Blob([bytes], { type: 'image/jpeg' }),
    'receipt.jpg',
  )
  form.append(
    'options',
    new Blob(
      [JSON.stringify({ decoding: { max_output_tokens: 4096 } })],
      { type: 'application/json' },
    ),
  )

  const response = await fetch(PARSE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    body: form,
  })

  if (!response.ok) {
    throw new Error(`Nemotron parse failed (${response.status}): ${await response.text()}`)
  }

  const result = (await response.json()) as { content?: string }
  const content = result.content ?? ''

  const iso = content.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  const dmy = content.match(/\b(\d{1,2})[.,/-](\d{1,2})[.,/-](\d{4})\b/)
  const date =
    iso?.[0] ??
    (dmy
      ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
      : null)

  return { date }
}

const graph = new StateGraph(State)
  .addNode('parse', parse)
  .addEdge(START, 'parse')
  .addEdge('parse', END)
  .compile()

export const getReceiptDate = async (pdfPath: string): Promise<string | null> => {
  const document = await pdf(pdfPath, { format: 'jpeg', scale: 2 })

  try {
    const image = await document.getPage(1)
    const result = await graph.invoke({ image })

    return result.date
  } finally {
    await document.destroy()
  }
}
