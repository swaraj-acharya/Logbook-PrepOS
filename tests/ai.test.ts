// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { textStream } from '../lib/ai';

const sse = events => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); for (const ev of events) c.enqueue(e.encode('event: x\ndata: ' + JSON.stringify(ev) + '\n\n')); c.close(); } }));

describe('AI streaming', () => {
  it('turns Anthropic events into plain text', async () => {
    const up = sse([{ type: 'message_start' }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Recall ' } }, { type: 'ping' }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'phasors first.' } }, { type: 'message_stop' }]);
    expect(await new Response(textStream(up)).text()).toBe('Recall phasors first.');
  });
  it('surfaces a mid-stream error', async () => {
    const up = sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }, { type: 'error', error: { message: 'overloaded' } }]);
    await expect(new Response(textStream(up)).text()).rejects.toThrow(/overloaded/);
  });
});
