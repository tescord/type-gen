import { Tescord, ContentValue, PlainLocaleData } from 'tescord';

// Interface for parameter extraction from localized strings
interface ExtractedParameter {
  name: string;
  type: string;
}

// Configuration for type generation
interface TypeGenerationConfig {
  tescords: Tescord[];
  outputPath?: string;
}

// Configuration for component type generation
interface ComponentTypeGenerationConfig {
  tescords: Tescord[];
  outputPath?: string;
}

// Interface for component mapping
interface ComponentMapping {
  [customId: string]: string;
}

/**
 * Extracts parameter information from a localized string
 * Examples:
 * "{0} is now a {1}" -> [{ name: "_0", type: "string" }, { name: "_1", type: "string" }]
 * "{0:user} is now a {1:role}" -> [{ name: "user", type: "string" }, { name: "role", type: "string" }]
 */
function extractParameters(value: string): ExtractedParameter[] {
  const parameters: ExtractedParameter[] = [];
  const seen = new Set<string>(); // Track parameter names we've already seen
  const paramRegex = /\{(\d+)(?::([^}]+))?\}/g;
  let match;

  while ((match = paramRegex.exec(value)) !== null) {
    const index = match[1];
    const paramName = match[2] || `_${index}`;
    
    // Only add if we haven't seen this parameter name before
    if (!seen.has(paramName)) {
      seen.add(paramName);
      parameters.push({
        name: paramName,
        type: 'string' // For now, we assume all parameters are strings
      });
    }
  }

  // Don't sort - maintain the order parameters appear in the string
  // This ensures the function signature matches the parameter order in the template
  return parameters;
}

/**
 * Generates a TypeScript function signature from a localized string
 */
function generateFunctionSignature(value: string): string {
  const parameters = extractParameters(value);
  
  if (parameters.length === 0) {
    return '() => string';
  }

  const paramStrings = parameters.map(param => `${param.name}: ${param.type}`);
  return `(${paramStrings.join(', ')}) => string`;
}

/**
 * Recursively processes locale data to generate TypeScript interface properties
 */
function processLocaleData(data: PlainLocaleData, depth = 0): string {
  const lines: string[] = [];
  const indent = '  '.repeat(depth + 3); // Base indent for interface content

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      const signature = generateFunctionSignature(value);
      lines.push(`${indent}${key}: ${signature};`);
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`${indent}${key}: {`);
      lines.push(processLocaleData(value, depth + 1));
      lines.push(`${indent}};`);
    }
  }

  return lines.join('\n');
}

/**
 * Merges multiple locale data objects into a single structure
 */
function mergeLocaleData(...localeDataArray: PlainLocaleData[]): PlainLocaleData {
  const merged: PlainLocaleData = {};

  for (const localeData of localeDataArray) {
    deepMerge(merged, localeData);
  }

  return merged;
}

/**
 * Deep merge utility function
 */
function deepMerge(target: PlainLocaleData, source: PlainLocaleData): void {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if (!(key in target) || typeof target[key] !== 'object') {
        target[key] = {};
      }
      deepMerge(target[key] as PlainLocaleData, value);
    } else {
      target[key] = value;
    }
  }
}

/**
 * Extracts locale data from tescord's cache and converts it to plain data structure
 * This is the key function that processes the actual tescord cache data
 */
function extractPlainLocaleDataFromtescord(tescord: Tescord): PlainLocaleData {
  const mergedData: PlainLocaleData = {};

  // Process all cached locales from tescord.cache.locales
  for (const [localeId, cacheData] of tescord.cache.locales) {
    const locale = cacheData.data;
    
    // Access the private 'contents' field which contains the raw template strings
    // locale.content contains processed functions, but we need the original templates
    const localeAsAny = locale as any;
    const rawContents = localeAsAny.contents; // Collection<string, { language: Language; data: PlainLocaleData }>
    
    if (rawContents && typeof rawContents === 'object') {
      // rawContents is a Collection, iterate through it
      for (const [contentId, contentEntry] of rawContents) {
        if (contentEntry && contentEntry.data) {
          // contentEntry.data contains the PlainLocaleData with original template strings
          deepMerge(mergedData, contentEntry.data);
        }
      }
    } else {
      // Fallback to the old method if private field access doesn't work
      for (const [language, contentValue] of locale.content) {
        const plainData = extractPlainDataFromContentValue(contentValue);
        if (typeof plainData === 'object' && plainData !== null) {
          deepMerge(mergedData, plainData);
        }
        break;
      }
    }
  }

  return mergedData;
}

/**
 * Recursively extracts plain data from ContentValue objects
 * This handles the nested structure of locale data
 */
function extractPlainDataFromContentValue(value: any): PlainLocaleData | string {
  if (typeof value === 'string') {
    return value;
  }
  
  if (typeof value === 'function') {
    // For functions, we need to extract parameter information
    // Since we can't get the original template string easily,
    // we'll analyze the function to determine parameters
    return extractParametersFromFunction(value);
  }
  
  if (typeof value === 'object' && value !== null) {
    const result: PlainLocaleData = {};
    
    for (const [key, subValue] of Object.entries(value)) {
      if (key === 'length' || key === 'name' || key === 'prototype') {
        // Skip function properties
        continue;
      }
      
      const extracted = extractPlainDataFromContentValue(subValue);
      if (extracted !== null && extracted !== undefined) {
        result[key] = extracted;
      }
    }
    
    return result;
  }
  
  return '';
}

/**
 * Attempts to extract parameter information from a localization function
 * This is a heuristic approach since we don't have direct access to the template
 */
function extractParametersFromFunction(func: Function): string {
  // Check function length to determine parameter count
  const paramCount = func.length;
  
  if (paramCount === 0) {
    return ''; // No parameters
  }
  
  // Generate a default template with numbered parameters
  const params = Array.from({ length: paramCount }, (_, i) => `{${i}}`);
  return params.join(' ');
}

/**
 * Generates TypeScript declaration for a single tescord instance
 */
function generatetescordDeclaration(tescord: Tescord, clientIndex?: number): string {
  const localeData = extractPlainLocaleDataFromtescord(tescord);
  const interfaceContent = processLocaleData(localeData);
  
  const clientSuffix = clientIndex !== undefined ? ` // Client ${clientIndex + 1}` : '';

  return `declare global {${clientSuffix}
  namespace Tescord {
    interface Localization {
${interfaceContent}
    }
  }
}
    
export { };`;
}

/**
 * Maps interaction types to their corresponding component types
 */
const INTERACTION_TYPE_MAP: Record<string, string> = {
  'Button': 'Button',
  'StringSelectMenu': 'StringSelectMenu',
  'UserSelectMenu': 'UserSelectMenu',
  'RoleSelectMenu': 'RoleSelectMenu',
  'ChannelSelectMenu': 'ChannelSelectMenu',
  'MentionableSelectMenu': 'MentionableSelectMenu',
  'Modal': 'Modal'
};

/**
 * Extracts component mappings from tescord's interactions cache
 */
function extractComponentMappingsFromtescord(tescord: Tescord): ComponentMapping {
  const componentMap: ComponentMapping = {};

  // Process all cached interactions from tescord.cache.interactions
  for (const [interactionId, cacheData] of tescord.cache.interactions) {
    const interaction = cacheData.data;
    
    // Check if the interaction has a type that maps to a component
    if (interaction && typeof interaction === 'object' && 'type' in interaction) {
      const interactionType = (interaction as any).type;
      const componentType = INTERACTION_TYPE_MAP[interactionType];
      
      if (componentType && 'id' in interaction && typeof (interaction as any).id === 'string') {
        componentMap[(interaction as any).id] = componentType;
      }
    }
  }

  return componentMap;
}

/**
 * Merges multiple component mappings into a single structure
 */
function mergeComponentMappings(...mappings: ComponentMapping[]): ComponentMapping {
  const merged: ComponentMapping = {};

  for (const mapping of mappings) {
    Object.assign(merged, mapping);
  }

  return merged;
}

/**
 * Generates TypeScript declaration for component mappings
 */
function generateComponentDeclaration(componentMap: ComponentMapping, clientIndex?: number): string {
  const entries = Object.entries(componentMap);
  
  if (entries.length === 0) {
    return '';
  }

  const clientSuffix = clientIndex !== undefined ? ` // Client ${clientIndex + 1}` : '';
  const interfaceContent = entries
    .map(([customId, componentType]) => `      '${customId}': '${componentType}';`)
    .join('\n');

  return `declare global {${clientSuffix}
  namespace Tescord {
    interface ComponentMap {
${interfaceContent}
    }
  }
}`;
}

/**
 * Main function to generate TypeScript declarations from multiple tescord instances
 */
export function generateLocalizationTypes(config: TypeGenerationConfig): string {
  const declarations: string[] = [];

  for (let i = 0; i < config.tescords.length; i++) {
    const tescord = config.tescords[i];
    const declaration = generatetescordDeclaration(tescord, config.tescords.length > 1 ? i : undefined);
    declarations.push(declaration);
  }

  return declarations.join('\n\n');
}

/**
 * Main function to generate TypeScript component declarations from multiple tescord instances
 */
export function generateComponentTypes(config: ComponentTypeGenerationConfig): string {
  const declarations: string[] = [];

  for (let i = 0; i < config.tescords.length; i++) {
    const tescord = config.tescords[i];
    const componentMap = extractComponentMappingsFromtescord(tescord);
    const declaration = generateComponentDeclaration(componentMap, config.tescords.length > 1 ? i : undefined);
    
    if (declaration) {
      declarations.push(declaration);
    }
  }

  if (declarations.length > 0) {
    declarations.push('export {};');
    return declarations.join('\n\n');
  }

  return '';
}

/**
 * Utility function to create a component type generation configuration
 */
export function createComponentTypeGenerationConfig(
  tescords: Tescord | Tescord[], 
  outputPath?: string
): ComponentTypeGenerationConfig {
  return {
    tescords: Array.isArray(tescords) ? tescords : [tescords],
    outputPath
  };
}

/**
 * Helper function to write generated component types to a file (Node.js environment)
 */
export async function writeComponentTypes(config: ComponentTypeGenerationConfig): Promise<void> {
  const { writeFile } = await import('fs/promises');
  const { join } = await import('path');
  
  const outputPath = config.outputPath || join(process.cwd(), 'components.d.ts');
  const generatedTypes = generateComponentTypes(config);
  
  if (generatedTypes.trim()) {
    await writeFile(outputPath, generatedTypes, 'utf-8');
  }
}

/**
 * Utility function to create a type generation configuration
 */
export function createTypeGenerationConfig(
  tescords: Tescord | Tescord[], 
  outputPath?: string
): TypeGenerationConfig {
  return {
    tescords: Array.isArray(tescords) ? tescords : [tescords],
    outputPath
  };
}

/**
 * Helper function to write generated types to a file (Node.js environment)
 */
export async function writeLocalizationTypes(config: TypeGenerationConfig): Promise<void> {
  const { writeFile } = await import('fs/promises');
  const { join } = await import('path');
  
  const outputPath = config.outputPath || join(process.cwd(), 'localization.d.ts');
  const generatedTypes = generateLocalizationTypes(config);
  await writeFile(outputPath, generatedTypes, 'utf-8');
}

// Re-export types for convenience
export type { TypeGenerationConfig, ExtractedParameter, ComponentTypeGenerationConfig, ComponentMapping };