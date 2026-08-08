import type {
  CustomPropertyName, CustomPropertyRegistration,
} from '../css/property';
import type { StyleEngine } from './engine';

// CSS Properties and Values API 1, 2. Determining the Registration
export function getCustomPropertyRegistration(
  engine: StyleEngine,
  name: CustomPropertyName,
): CustomPropertyRegistration | null {
  const registered = engine.registeredPropertySet.get(name);
  if (registered !== undefined) return registered;

  let declared = null;

  for (const association of engine.activeStyleSheets) {
    for (const rule of association.styleSheet.rules) {
      if (rule.type === 'property-rule' && rule.registration.name === name) {
        declared = rule.registration;
      }
    }
  }

  return declared;
}
