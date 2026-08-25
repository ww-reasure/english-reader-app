const cloneMessage = message => ({
  ...message,
  ...(Array.isArray(message?.content) ? { content: message.content.map(part => ({ ...part })) } : {})
});

const imagePayloadError = () => {
  const error = new Error('image_payload_unavailable');
  error.code = 'image_payload_unavailable';
  return error;
};

const attachmentOrder = attachment => Number.isFinite(Number(attachment?.order))
  ? Number(attachment.order)
  : Number.MAX_SAFE_INTEGER;

function textForMessage(message, prompt) {
  if (prompt !== undefined && prompt !== null) return String(prompt);
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content)) {
    return message.content
      .filter(part => part?.type === 'text')
      .map(part => String(part.text || ''))
      .join('');
  }
  return '';
}

function attachmentPart(attachment) {
  if (attachment?.remoteFileId) {
    return { type: 'file', file_id: String(attachment.remoteFileId) };
  }
  if (attachment?.inlineDataUrl) {
    return { type: 'image_url', image_url: { url: String(attachment.inlineDataUrl) } };
  }
  throw imagePayloadError();
}

export function assembleChatMessages({ messages = [], attachmentGroup = null } = {}) {
  const cloned = Array.isArray(messages) ? messages.map(cloneMessage) : [];
  if (!attachmentGroup) return cloned;
  let userIndex = -1;
  for (let index = cloned.length - 1; index >= 0; index -= 1) {
    if (cloned[index]?.role === 'user') {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) return cloned;
  const current = cloned[userIndex];
  const attachments = (Array.isArray(attachmentGroup.attachments) ? attachmentGroup.attachments : [])
    .slice()
    .sort((a, b) => attachmentOrder(a) - attachmentOrder(b) || String(a?.id || '').localeCompare(String(b?.id || '')));
  cloned[userIndex] = {
    ...current,
    content: [
      { type: 'text', text: textForMessage(current, attachmentGroup.prompt) },
      ...attachments.map(attachmentPart)
    ]
  };
  return cloned;
}

function responsePart(part) {
  if (part?.type === 'text') return { type: 'input_text', text: String(part.text || '') };
  if (part?.type === 'file' && part.file_id) {
    return { type: 'input_image', file_id: String(part.file_id), detail: 'original' };
  }
  if (part?.type === 'image_url' && part.image_url?.url) {
    return { type: 'input_image', image_url: { url: String(part.image_url.url) }, detail: 'original' };
  }
  return null;
}

export function messagesToVisionResponseItems(messages = []) {
  return (Array.isArray(messages) ? messages : []).map(message => {
    const cloned = cloneMessage(message);
    if (message?.role !== 'user' || !Array.isArray(message.content)) return cloned;
    cloned.content = message.content.map(responsePart).filter(Boolean);
    return cloned;
  });
}
