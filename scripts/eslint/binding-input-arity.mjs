import ts from 'typescript';

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      positional: 'Binding detects injected incumbent inputs by declared arity. Use positional parameters without defaults or rest parameters through incumbentEnv.',
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services.program) return {};
    const checker = services.program.getTypeChecker();

    function check(node) {
      const declaration = services.esTreeNodeToTSNodeMap.get(node);
      let type;
      if (ts.isMethodDeclaration(declaration) && ts.isObjectLiteralExpression(declaration.parent)) {
        const owner = checker.getContextualType(declaration.parent);
        const name = ts.isIdentifier(declaration.name) || ts.isStringLiteral(declaration.name) ? declaration.name.text : undefined;
        const member = owner && name && checker.getPropertyOfType(checker.getNonNullableType(owner), name);
        if (member) type = checker.getTypeOfSymbolAtLocation(member, declaration);
      } else if (ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration)) {
        type = checker.getContextualType(declaration);
      }
      if (!type) return;
      const signature = checker.getNonNullableType(type).getCallSignatures()[0];
      const incumbent = signature?.parameters.findIndex((parameter) => parameter.name === 'incumbentEnv') ?? -1;
      if (incumbent < 0) return;
      // A TypeScript `this` parameter does not contribute to JavaScript function.length.
      const parameters = node.params.filter((parameter) => parameter.type !== 'Identifier' || parameter.name !== 'this');
      for (const parameter of parameters.slice(0, incumbent + 1)) {
        if (parameter.type === 'AssignmentPattern' || parameter.type === 'RestElement') {
          context.report({ node: parameter, messageId: 'positional' });
        }
      }
    }

    return { FunctionExpression: check, ArrowFunctionExpression: check };
  },
};
