export type AgentModelOption = {
  id: string;
  provider: "qwen" | "kimi";
  model: string;
  label: string;
  description: string;
  enabled: boolean;
  supportsImageInput: boolean;
};

export function getAgentModels(): AgentModelOption[] {
  return [
    {
      id: "qwen-qwen3-vl-flash",
      provider: "qwen",
      model: "qwen3-vl-flash",
      label: "Qwen 3 VL Flash",
      description: "视觉理解主力，适合图像理解和场景描述。",
      enabled: Boolean(process.env.QWEN_API_KEY),
      supportsImageInput: true
    },
    {
      id: "kimi-k2.5",
      provider: "kimi",
      model: "kimi-k2.5",
      label: "Kimi 2.5",
      description: "家庭场景理解首选，支持图片输入。",
      enabled: Boolean(process.env.KIMI_API_KEY),
      supportsImageInput: true
    }
  ];
}

export function getAgentModelById(id: string) {
  return getAgentModels().find((item) => item.id === id);
}
