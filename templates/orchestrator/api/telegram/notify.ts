import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sendMessage } from '../../lib/telegram'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' })
  }

  const { message, parseMode } = req.body as { message: string; parseMode?: 'HTML' | 'Markdown' }

  if (!message) {
    return res.status(400).json({ error: 'Missing required field: message' })
  }

  try {
    const success = await sendMessage(message, parseMode || 'HTML')
    return res.status(success ? 200 : 502).json({ sent: success })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
}
