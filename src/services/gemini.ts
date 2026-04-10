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

export interface SelfModificationExecutionStep {
  id: string;
  status: 'ok' | 'error' | 'skipped';
  detail: string;
}

export interface SelfModificationExecution {
  mode: 'manual' | 'auto';
  success: boolean;
  targetFile: string;
  backupPath: string | null;
  restartScheduled: boolean;
  rolledBack: boolean;
  steps: SelfModificationExecutionStep[];
  error?: string;
}

export interface AgentResponse {
  text?: string;
  error?: string;
  modelUsed?: string;
  warning?: string;
  selfModification?: {
    attempted?: boolean;
    ok?: boolean;
    targetFile?: string;
    backupPath?: string;
    execution?: SelfModificationExecution;
  };
}

export const getAgentResponse = async (
  prompt: string,
  context?: string,
  parts: AgentPart[] = [],
  research?: AgentResearchOptions,
): Promise<AgentResponse> => {
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
    const text = data.warning && data.text ? `${data.warning}\n\n${data.text}` : data.text || 'No response from model.';
    if (!response.ok) {
      console.error('Agent API Error:', data.error || response.statusText);
    }

    return {
      ...data,
      text,
    } as AgentResponse;
  } catch (error) {
    console.error("Agent API Network Error:", error);
    return {
      text: "I'm sorry, I encountered an error while processing your request.",
      error: String(error),
    } as AgentResponse;
  }
};
