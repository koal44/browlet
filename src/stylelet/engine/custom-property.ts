import type {
  CustomPropertyName, CustomPropertyRegistration,
} from '../css/property';
import type { CascadeEngine } from './cascade-engine';
import type { DocumentOrShadowRootStyleState } from './document-or-shadow-root';

// CSS Properties and Values API 1, 2. Determining the Registration
export function getCustomPropertyRegistration(
  engine: CascadeEngine,
  name: CustomPropertyName,
  state: DocumentOrShadowRootStyleState,
): CustomPropertyRegistration | null {
  const registered = engine.registeredPropertySet.get(name);
  if (registered !== undefined) return registered;

  let declared = null;

  for (const styleSheet of engine.getActiveStyleSheets(state)) {
    for (const rule of styleSheet.__styleSheet.rules) {
      if (rule.type === 'property-rule' && rule.registration.name === name) {
        declared = rule.registration;
      }
    }
  }

  return declared;
}
