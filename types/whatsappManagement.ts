export interface WhatsAppMetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: Array<{ type: string; text?: string }>;
}

export interface WhatsAppMetaTemplateDraft {
  name: string;
  language: string;
  category: 'UTILITY' | 'MARKETING';
  body: string;
  examples: string[];
}

export interface WhatsAppPhoneStatus {
  status: string;
  code_verification_status: string;
  display_phone_number: string;
  can_register: boolean;
}
