export interface ServiceGuide { title: string; steps: string[]; downloadUrl?: string; connectionUrl?: string; connectionLabel?: string }
export type ServiceGuides = Partial<Record<'ios' | 'android', ServiceGuide>>;
export function validateGuides(value: unknown): ServiceGuides | undefined;
