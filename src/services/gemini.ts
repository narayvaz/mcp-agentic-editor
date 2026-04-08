export interface AgentPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

export interface AgentResearchOptions {
  web?: boolean;
  scholar?: boolean;
  notebook?: boolean;
  articleMode?: boolean;
}

interface AgentResponse {
  text?: string;
  error?: string;
  modelUsed?: string;
  warning?: string;
}

export const getAgentResponse = async (
  prompt: string,
  context?: string,
  parts: AgentPart[] = [],
  research?: AgentResearchOptions,
) => {
  try {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        context,
        parts,
        research,
      }),
    });

    const data = (await response.json()) as AgentResponse;
    if (!response.ok) {
      console.error("Agent API Error:", data.error || response.statusText);
      return data.text || "I'm sorry, I encountered an error while processing your request.";
    }

    if (data.warning && data.text) {
      return `${data.warning}\n\n${data.text}`;
    }

    return data.text || "No response from model.";
  } catch (error) {
    console.error("Agent API Network Error:", error);
    return "I'm sorry, I encountered an error while processing your request.";
  }
};
