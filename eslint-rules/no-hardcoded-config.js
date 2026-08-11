// Plain JS (not TS): ESLint loads custom rule modules directly, before
// any TypeScript compilation step exists in this project — see RULES.md
// for the rationale. Excluded from tsconfig.json's `include` so `tsc`
// never tries to typecheck it. ESM (not CJS) because package.json sets
// "type": "module", which makes Node treat every .js file as ESM.

const DEFAULT_ALLOWED_NUMBERS = [0, 1, -1];
const HTTP_STATUS_MIN = 200;
const HTTP_STATUS_MAX = 599;

const DEFAULT_BANNED_STRINGS = [
  'aws',
  'gcp',
  'azure',
  'postgres',
  'mongo',
  'mongodb',
  'redis',
  's3',
  'dynamodb',
  'secretsmanager',
  'ecs',
];

const BANNED_IMPORT_PREFIXES = ['@aws-sdk/', '@prisma/client', 'mongoose', 'ioredis'];

function isHttpStatusCode(value) {
  return Number.isInteger(value) && value >= HTTP_STATUS_MIN && value <= HTTP_STATUS_MAX;
}

// Parent node types where a numeric literal is structural, not a runtime
// "magic number" — enum values, type-level literals, and computed member
// access like arr[0] (the array-index edge case from the WO spec).
function isExcludedNumericParent(parent) {
  if (!parent) {
    return false;
  }
  return (
    parent.type === 'TSEnumMember' ||
    parent.type === 'TSLiteralType' ||
    (parent.type === 'MemberExpression' && parent.computed === true)
  );
}

// Parent node types where a string literal is type-level or an import
// source, not a runtime value — these are never zero-hardcoding
// violations regardless of the string's content.
function isExcludedStringParent(parent) {
  if (!parent) {
    return false;
  }
  return (
    parent.type === 'TSLiteralType' ||
    parent.type === 'TSEnumMember' ||
    parent.type === 'ImportDeclaration' ||
    parent.type === 'ExportNamedDeclaration' ||
    parent.type === 'ExportAllDeclaration' ||
    parent.type === 'TSInterfaceDeclaration'
  );
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hardcoded numeric literals, provider/engine strings, and direct SDK imports in agent code (zero-hardcoding policy). See RULES.md.',
      recommended: false,
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedNumbers: {
            type: 'array',
            items: { type: 'number' },
          },
          allowedStrings: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      hardcodedNumber:
        'Bare numeric literal {{value}} in agent code. Use a config table entry, env var, or registry value instead. See RULES.md for details.',
      hardcodedString:
        'Hardcoded provider/engine string "{{value}}" in agent code. Resolve this via the registry or config module instead of a fixed string. See RULES.md for details.',
      hardcodedImport:
        'Direct SDK import "{{value}}" is not allowed in agent code. Agents must depend on adapter interfaces (src/adapters/**), not concrete provider SDKs. See RULES.md for details.',
      hardcodedTemplateLiteral:
        'Template literal contains hardcoded provider/engine string "{{value}}" in agent code. See RULES.md for details.',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const allowedNumbers = new Set([...DEFAULT_ALLOWED_NUMBERS, ...(options.allowedNumbers || [])]);
    const allowedStrings = new Set((options.allowedStrings || []).map((s) => s.toLowerCase()));
    const bannedStrings = new Set(DEFAULT_BANNED_STRINGS);

    function isBannedString(value) {
      const lower = value.toLowerCase();
      return bannedStrings.has(lower) && !allowedStrings.has(lower);
    }

    function containsBannedString(value) {
      const lower = value.toLowerCase();
      for (const banned of bannedStrings) {
        if (lower.includes(banned) && !allowedStrings.has(banned)) {
          return banned;
        }
      }
      return null;
    }

    return {
      Literal(node) {
        if (typeof node.value === 'number') {
          if (allowedNumbers.has(node.value) || isHttpStatusCode(node.value)) {
            return;
          }
          if (isExcludedNumericParent(node.parent)) {
            return;
          }
          context.report({ node, messageId: 'hardcodedNumber', data: { value: String(node.value) } });
          return;
        }

        if (typeof node.value === 'string') {
          if (isExcludedStringParent(node.parent)) {
            return;
          }
          if (isBannedString(node.value)) {
            context.report({ node, messageId: 'hardcodedString', data: { value: node.value } });
          }
        }
      },

      TemplateLiteral(node) {
        if (isExcludedStringParent(node.parent)) {
          return;
        }
        for (const quasi of node.quasis) {
          const match = containsBannedString(quasi.value.raw);
          if (match) {
            context.report({
              node,
              messageId: 'hardcodedTemplateLiteral',
              data: { value: match },
            });
            return;
          }
        }
      },

      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== 'string') {
          return;
        }
        const isBanned = BANNED_IMPORT_PREFIXES.some((prefix) => source.startsWith(prefix));
        if (isBanned) {
          context.report({ node, messageId: 'hardcodedImport', data: { value: source } });
        }
      },
    };
  },
};
