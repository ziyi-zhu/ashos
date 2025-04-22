export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}


export interface Voices {
  [key: string]: string; 
}

export interface TTSRequest {
  text: string;
  voice: keyof Voices;
  speed: number;
} 