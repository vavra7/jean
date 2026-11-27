import './env.js'
import Fastify from 'fastify'
import { graph } from './graph.js'
import { renameReceipts } from './rename-receipts.js'

const app = Fastify({ logger: true })

app.get('/hello', async () => ({ message: 'Hello, World!' }))

app.post<{ Body: { text: string } }>('/langgraph', async (request) =>
  graph.invoke({ text: request.body.text ?? '' }),
)

app.post<{ Body: { path: string } }>('/rename-receipts', async (request) =>
  renameReceipts(request.body.path),
)

const port = Number(process.env.PORT)

try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
