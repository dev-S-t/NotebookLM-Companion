export type ChatMessage = {
  sender: 'human' | 'agent';
  message: string;
  timestamp?: string;
  thinking?: string;
};

export type ParsedChat = {
  title: string;
  conversation: ChatMessage[];
};

export const parseGeminiChat = (rawText: string): ParsedChat => {
  const rawLines = rawText.split('\n').map(line => line.trim());
  
  let title = "Unknown Title";
  if (rawLines.length >= 2 && rawLines[0] === "Gemini") {
    title = rawLines[1];
  }
  
  let startIdx = 0;
  let endIdx = rawLines.length;
  
  for (let i = 0; i < rawLines.length; i++) {
    if (rawLines[i] === "Conversation with Gemini") {
      startIdx = i + 1;
      break;
    }
  }
  
  for (let i = startIdx; i < rawLines.length; i++) {
    if (rawLines[i].includes("Gemini is AI and can make mistakes") || rawLines[i].includes("Gemini may display inaccurate info")) {
      endIdx = i;
      break;
    }
  }
  
  const isolatedLines = rawLines.slice(startIdx, endIdx);
  const conversation: ChatMessage[] = [];
  
  const tsPattern = /^(?:\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} (?:AM|PM) [A-Z]{3,4}|\d{1,2} [A-Z][a-z]{2}|\d{2}:\d{2})$/;
  
  const thinkingTriggers = [
    "Defining", "Refining", "Analyzing", "Synthesizing", 
    "Synthesized", "Pivoted", "Orchestrated", "Commenced", 
    "Identifying", "Show more"
  ];
  
  let currentSender: 'human' | 'agent' | null = null;
  let currentBody: string[] = [];
  let currentTimestamp: string | undefined = undefined;
  let thinkingBuffer: string[] = [];
  
  for (const line of isolatedLines) {
    if (line === "You said") {
      if (currentSender === 'agent') {
        conversation.push({
          sender: 'agent',
          message: currentBody.filter(ln => ln).join('\n').trim(),
          ...(currentTimestamp ? { timestamp: currentTimestamp } : {}),
          ...(thinkingBuffer.length ? { thinking: thinkingBuffer.join('\n').trim() } : {})
        });
      }
      currentSender = 'human';
      currentBody = [];
      currentTimestamp = undefined;
      thinkingBuffer = [];
    } else if (line === "Gemini said") {
      if (currentSender === 'human') {
        const userText: string[] = [];
        const thinkText: string[] = [];
        let inThinking = false;
        
        for (const part of currentBody) {
          if (!part) continue;
          
          if (tsPattern.test(part)) {
            currentTimestamp = part;
            inThinking = true;
            continue;
          }
          
          if (!inThinking) {
            if (thinkingTriggers.some(t => part.startsWith(t)) && part.split(/\s+/).length <= 15) {
              inThinking = true;
            }
          }
          
          if (inThinking) {
            thinkText.push(part);
          } else {
            userText.push(part);
          }
        }
        
        conversation.push({
          sender: 'human',
          message: userText.join('\n').trim()
        });
        
        thinkingBuffer = thinkText;
      }
      
      currentSender = 'agent';
      currentBody = [];
    } else {
      if (currentSender) {
        if (tsPattern.test(line) && currentSender === 'agent') {
          currentTimestamp = line;
        } else {
          currentBody.push(line);
        }
      }
    }
  }
  
  if (currentSender === 'agent') {
    conversation.push({
      sender: 'agent',
      message: currentBody.filter(ln => ln).join('\n').trim(),
      ...(currentTimestamp ? { timestamp: currentTimestamp } : {}),
      ...(thinkingBuffer.length ? { thinking: thinkingBuffer.join('\n').trim() } : {})
    });
  } else if (currentSender === 'human') {
    // Edge case if conversation ends with human
    conversation.push({
      sender: 'human',
      message: currentBody.filter(ln => ln).join('\n').trim()
    });
  }
  
  return {
    title,
    conversation: conversation.filter(msg => msg.message || msg.thinking)
  };
};

export type ChatSplitSettings = {
  enabled: boolean;
  mode: 'parts' | 'chars' | 'lines';
  value: number;
  overlap: number;
  startWith: 'any' | 'human' | 'agent';
  endWith: 'any' | 'human' | 'agent';
};

export const splitChat = (chat: ParsedChat, settings: ChatSplitSettings): ParsedChat[] => {
  if (!settings.enabled || chat.conversation.length === 0) return [chat];
  
  const chunks: ParsedChat[] = [];
  const msgs = chat.conversation;
  
  const getMessageSize = (msg: ChatMessage, mode: 'chars' | 'lines') => {
    let text = `**${msg.sender === 'human' ? 'User' : 'Agent'}**\n${msg.message}`;
    if (msg.thinking) text += `\n*Thinking*\n${msg.thinking}`;
    if (mode === 'chars') return text.length;
    return text.split('\n').length;
  };

  if (settings.mode === 'parts') {
    const numParts = Math.max(1, settings.value);
    const msgsPerPart = Math.ceil(msgs.length / numParts);
    let i = 0;
    while (i < msgs.length) {
      let end = Math.min(i + msgsPerPart, msgs.length);
      
      // Adjust for start/end constraints
      if (settings.startWith !== 'any' && i < msgs.length) {
        while (i < msgs.length && msgs[i].sender !== settings.startWith) i++;
      }
      if (i >= msgs.length) break;
      
      if (settings.endWith !== 'any' && end < msgs.length) {
        while (end > i && msgs[end - 1].sender !== settings.endWith) end--;
        if (end === i) end = Math.min(i + msgsPerPart, msgs.length); // Fallback
      }
      
      const overlapMsgs = end < msgs.length ? Math.min(settings.overlap, msgs.length - end) : 0;
      chunks.push({
        title: `${chat.title} (Part ${chunks.length + 1})`,
        conversation: msgs.slice(i, end + overlapMsgs)
      });
      i = end;
    }
  } else {
    const targetSize = settings.value;
    let i = 0;
    while (i < msgs.length) {
      if (settings.startWith !== 'any') {
        while (i < msgs.length && msgs[i].sender !== settings.startWith) i++;
      }
      if (i >= msgs.length) break;

      let currentSize = 0;
      let end = i;
      while (end < msgs.length) {
        currentSize += getMessageSize(msgs[end], settings.mode);
        end++;
        if (currentSize >= targetSize) {
          if (settings.endWith !== 'any') {
            while (end < msgs.length && msgs[end - 1].sender !== settings.endWith) {
              currentSize += getMessageSize(msgs[end], settings.mode);
              end++;
            }
          }
          break;
        }
      }
      
      let overlapMsgs = 0;
      let overlapSize = 0;
      while (end + overlapMsgs < msgs.length && overlapSize < settings.overlap) {
        overlapSize += getMessageSize(msgs[end + overlapMsgs], settings.mode);
        overlapMsgs++;
      }

      chunks.push({
        title: `${chat.title} (Part ${chunks.length + 1})`,
        conversation: msgs.slice(i, end + overlapMsgs)
      });
      i = end;
    }
  }
  
  return chunks.length > 0 ? chunks : [chat];
};

export const formatChatToMarkdown = (chat: ParsedChat, filter: 'all' | 'human' | 'agent' = 'all'): string => {
  let md = `# ${chat.title}\n\n`;
  for (const msg of chat.conversation) {
    if (filter !== 'all' && msg.sender !== filter) continue;
    
    md += `### ${msg.sender === 'human' ? 'User' : 'Agent'}`;
    if (msg.timestamp) md += ` (${msg.timestamp})`;
    md += `\n\n`;
    
    if (msg.thinking) {
      md += `<details>\n<summary>Thinking Process</summary>\n\n${msg.thinking}\n\n</details>\n\n`;
    }
    
    md += `${msg.message}\n\n---\n\n`;
  }
  return md;
};
