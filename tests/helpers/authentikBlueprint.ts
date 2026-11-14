import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocument, YAMLSeq } from 'yaml';

const passthroughTag = (tag: string) => ({
  tag,
  identify: (_value: unknown) => false,
  resolve: (value: unknown) => value,
});

const customTags = [
  passthroughTag('!Env'),
  passthroughTag('!KeyOf'),
  {
    ...passthroughTag('!Condition'),
    collection: 'seq' as const,
    nodeClass: YAMLSeq,
  },
  {
    ...passthroughTag('!Find'),
    collection: 'seq' as const,
    nodeClass: YAMLSeq,
  },
];

export type BlueprintEntry = {
  model: string;
  id?: string;
  conditions?: unknown[];
  identifiers?: Record<string, unknown>;
  attrs?: Record<string, unknown>;
  permissions?: Array<{ permission: string; role?: unknown; user?: unknown }>;
};

export type AuthentikBlueprint = {
  entries: BlueprintEntry[];
};

export function loadAuthentikBlueprint(): AuthentikBlueprint {
  const source = readFileSync(resolve(process.cwd(), 'deploy/authentik/blueprints/portal-access-groups.yaml'), 'utf8');
  const document = parseDocument(source, { customTags });
  if (document.errors.length > 0) {
    throw new Error(`Authentik blueprint YAML is invalid: ${document.errors.map((error) => error.message).join('; ')}`);
  }
  return document.toJS() as AuthentikBlueprint;
}
