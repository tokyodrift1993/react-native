/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';
import type {
  ComponentShape,
  EventTypeShape,
  PropTypeAnnotation,
} from '../../CodegenSchema';
import type {SchemaType} from '../../CodegenSchema';

const core = require('@babel/core');

const t = core.types;

// File path -> contents
type FilesOutput = Map<string, string>;

const FileTemplate = ({
  imports,
  componentConfig,
}: {
  imports: string,
  componentConfig: string,
}) => `
/**
 * This code was generated by [react-native-codegen](https://www.npmjs.com/package/react-native-codegen).
 *
 * Do not edit this file as changes may cause incorrect behavior and will be lost
 * once the code is regenerated.
 *
 * @flow
 *
 * ${'@'}generated by codegen project: GenerateViewConfigJs.js
 */

'use strict';

${imports}

${componentConfig}
`;

// We use this to add to a set. Need to make sure we aren't importing
// this multiple times.
const UIMANAGER_IMPORT = 'const {UIManager} = require("react-native")';

function expression(input: string) {
  return core.template.expression(input)();
}

function getReactDiffProcessValue(typeAnnotation: PropTypeAnnotation) {
  switch (typeAnnotation.type) {
    case 'BooleanTypeAnnotation':
    case 'StringTypeAnnotation':
    case 'Int32TypeAnnotation':
    case 'DoubleTypeAnnotation':
    case 'FloatTypeAnnotation':
    case 'ObjectTypeAnnotation':
    case 'StringEnumTypeAnnotation':
    case 'Int32EnumTypeAnnotation':
    case 'MixedTypeAnnotation':
      return t.booleanLiteral(true);
    case 'ReservedPropTypeAnnotation':
      switch (typeAnnotation.name) {
        case 'ColorPrimitive':
          return expression(
            "{ process: require('react-native/Libraries/StyleSheet/processColor').default }",
          );
        case 'ImageSourcePrimitive':
          return expression(
            "{ process: ((req) => 'default' in req ? req.default : req)(require('react-native/Libraries/Image/resolveAssetSource')) }",
          );
        case 'ImageRequestPrimitive':
          throw new Error('ImageRequest should not be used in props');
        case 'PointPrimitive':
          return expression(
            "{ diff: ((req) => 'default' in req ? req.default : req)(require('react-native/Libraries/Utilities/differ/pointsDiffer')) }",
          );
        case 'EdgeInsetsPrimitive':
          return expression(
            "{ diff: ((req) => 'default' in req ? req.default : req)(require('react-native/Libraries/Utilities/differ/insetsDiffer')) }",
          );
        case 'DimensionPrimitive':
          return t.booleanLiteral(true);
        default:
          (typeAnnotation.name: empty);
          throw new Error(
            `Received unknown native typeAnnotation: "${typeAnnotation.name}"`,
          );
      }
    case 'ArrayTypeAnnotation':
      if (typeAnnotation.elementType.type === 'ReservedPropTypeAnnotation') {
        switch (typeAnnotation.elementType.name) {
          case 'ColorPrimitive':
            return expression(
              "{ process: ((req) => 'default' in req ? req.default : req)(require('react-native/Libraries/StyleSheet/processColorArray')) }",
            );
          case 'ImageSourcePrimitive':
          case 'PointPrimitive':
          case 'EdgeInsetsPrimitive':
          case 'DimensionPrimitive':
            return t.booleanLiteral(true);
          default:
            throw new Error(
              `Received unknown array native typeAnnotation: "${typeAnnotation.elementType.name}"`,
            );
        }
      }
      return t.booleanLiteral(true);
    default:
      (typeAnnotation: empty);
      throw new Error(
        `Received unknown typeAnnotation: "${typeAnnotation.type}"`,
      );
  }
}

const ComponentTemplate = ({
  componentName,
  paperComponentName,
  paperComponentNameDeprecated,
}: {
  componentName: string,
  paperComponentName: ?string,
  paperComponentNameDeprecated: ?string,
}) => {
  const nativeComponentName = paperComponentName ?? componentName;

  return `
let nativeComponentName = '${nativeComponentName}';
${
  paperComponentNameDeprecated != null
    ? DeprecatedComponentNameCheckTemplate({
        componentName,
        paperComponentNameDeprecated,
      })
    : ''
}

export const __INTERNAL_VIEW_CONFIG = %%VIEW_CONFIG%%;

export default NativeComponentRegistry.get(nativeComponentName, () => __INTERNAL_VIEW_CONFIG);
`.trim();
};

// Check whether the native component exists in the app binary.
// Old getViewManagerConfig() checks for the existance of the native Paper view manager. Not available in Bridgeless.
// New hasViewManagerConfig() queries Fabric’s native component registry directly.
const DeprecatedComponentNameCheckTemplate = ({
  componentName,
  paperComponentNameDeprecated,
}: {
  componentName: string,
  paperComponentNameDeprecated: string,
}) =>
  `
if (UIManager.hasViewManagerConfig('${componentName}')) {
  nativeComponentName = '${componentName}';
} else if (UIManager.hasViewManagerConfig('${paperComponentNameDeprecated}')) {
  nativeComponentName = '${paperComponentNameDeprecated}';
} else {
  throw new Error('Failed to find native component for either "${componentName}" or "${paperComponentNameDeprecated}"');
}
`.trim();

// Replicates the behavior of RCTNormalizeInputEventName in RCTEventDispatcher.m
function normalizeInputEventName(name: string) {
  if (name.startsWith('on')) {
    return name.replace(/^on/, 'top');
  } else if (!name.startsWith('top')) {
    return `top${name[0].toUpperCase()}${name.slice(1)}`;
  }

  return name;
}

// Replicates the behavior of viewConfig in RCTComponentData.m
function getValidAttributesForEvents(
  events: $ReadOnlyArray<EventTypeShape>,
  imports: Set<string>,
) {
  imports.add(
    "const {ConditionallyIgnoredEventHandlers} = require('react-native/Libraries/NativeComponent/ViewConfigIgnore');",
  );

  const validAttributes = t.objectExpression(
    events.map(eventType => {
      return t.objectProperty(
        t.identifier(eventType.name),
        t.booleanLiteral(true),
      );
    }),
  );

  return t.callExpression(t.identifier('ConditionallyIgnoredEventHandlers'), [
    validAttributes,
  ]);
}

function generateBubblingEventInfo(
  event: EventTypeShape,
  nameOveride: void | string,
) {
  return t.objectProperty(
    t.identifier(normalizeInputEventName(nameOveride || event.name)),
    t.objectExpression([
      t.objectProperty(
        t.identifier('phasedRegistrationNames'),
        t.objectExpression([
          t.objectProperty(
            t.identifier('captured'),
            t.stringLiteral(`${event.name}Capture`),
          ),
          t.objectProperty(
            t.identifier('bubbled'),
            t.stringLiteral(event.name),
          ),
        ]),
      ),
    ]),
  );
}

function generateDirectEventInfo(
  event: EventTypeShape,
  nameOveride: void | string,
) {
  return t.objectProperty(
    t.identifier(normalizeInputEventName(nameOveride || event.name)),
    t.objectExpression([
      t.objectProperty(
        t.identifier('registrationName'),
        t.stringLiteral(event.name),
      ),
    ]),
  );
}

function buildViewConfig(
  schema: SchemaType,
  componentName: string,
  component: ComponentShape,
  imports: Set<string>,
) {
  const componentProps = component.props;
  const componentEvents = component.events;

  component.extendsProps.forEach(extendProps => {
    switch (extendProps.type) {
      case 'ReactNativeBuiltInType':
        switch (extendProps.knownTypeName) {
          case 'ReactNativeCoreViewProps':
            imports.add(
              "const NativeComponentRegistry = require('react-native/Libraries/NativeComponent/NativeComponentRegistry');",
            );

            return;
          default:
            (extendProps.knownTypeName: empty);
            throw new Error('Invalid knownTypeName');
        }
      default:
        (extendProps.type: empty);
        throw new Error('Invalid extended type');
    }
  });

  const validAttributes = t.objectExpression([
    ...componentProps.map(schemaProp => {
      return t.objectProperty(
        t.identifier(schemaProp.name),
        getReactDiffProcessValue(schemaProp.typeAnnotation),
      );
    }),
    ...(componentEvents.length > 0
      ? [t.spreadElement(getValidAttributesForEvents(componentEvents, imports))]
      : []),
  ]);

  const bubblingEventNames = component.events
    .filter(event => event.bubblingType === 'bubble')
    .reduce((bubblingEvents: Array<any>, event) => {
      // We add in the deprecated paper name so that it is in the view config.
      // This means either the old event name or the new event name can fire
      // and be sent to the listener until the old top level name is removed.
      if (event.paperTopLevelNameDeprecated) {
        bubblingEvents.push(
          generateBubblingEventInfo(event, event.paperTopLevelNameDeprecated),
        );
      } else {
        bubblingEvents.push(generateBubblingEventInfo(event));
      }
      return bubblingEvents;
    }, []);

  const directEventNames = component.events
    .filter(event => event.bubblingType === 'direct')
    .reduce((directEvents: Array<any>, event) => {
      // We add in the deprecated paper name so that it is in the view config.
      // This means either the old event name or the new event name can fire
      // and be sent to the listener until the old top level name is removed.
      if (event.paperTopLevelNameDeprecated) {
        directEvents.push(
          generateDirectEventInfo(event, event.paperTopLevelNameDeprecated),
        );
      } else {
        directEvents.push(generateDirectEventInfo(event));
      }
      return directEvents;
    }, []);

  const properties: Array<
    BabelNodeObjectMethod | BabelNodeObjectProperty | BabelNodeSpreadElement,
  > = [
    t.objectProperty(
      t.identifier('uiViewClassName'),
      t.stringLiteral(componentName),
    ),
  ];

  if (bubblingEventNames.length > 0) {
    properties.push(
      t.objectProperty(
        t.identifier('bubblingEventTypes'),
        t.objectExpression(bubblingEventNames),
      ),
    );
  }
  if (directEventNames.length > 0) {
    properties.push(
      t.objectProperty(
        t.identifier('directEventTypes'),
        t.objectExpression(directEventNames),
      ),
    );
  }

  properties.push(
    t.objectProperty(t.identifier('validAttributes'), validAttributes),
  );
  return t.objectExpression(properties);
}

function buildCommands(
  schema: SchemaType,
  componentName: string,
  component: ComponentShape,
  imports: Set<string>,
) {
  const commands = component.commands;

  if (commands.length === 0) {
    return null;
  }

  imports.add(
    'const {dispatchCommand} = require("react-native/Libraries/ReactNative/RendererProxy");',
  );

  const commandsObject = t.objectExpression(
    commands.map(command => {
      const commandName = command.name;
      const params = command.typeAnnotation.params;

      const dispatchCommandCall = t.callExpression(
        t.identifier('dispatchCommand'),
        [
          t.identifier('ref'),
          t.stringLiteral(commandName),
          t.arrayExpression(params.map(param => t.identifier(param.name))),
        ],
      );

      return t.objectMethod(
        'method',
        t.identifier(commandName),
        [t.identifier('ref'), ...params.map(param => t.identifier(param.name))],
        t.blockStatement([t.expressionStatement(dispatchCommandCall)]),
      );
    }),
  );

  return t.exportNamedDeclaration(
    t.variableDeclaration('const', [
      t.variableDeclarator(t.identifier('Commands'), commandsObject),
    ]),
  );
}

module.exports = {
  generate(libraryName: string, schema: SchemaType): FilesOutput {
    try {
      const fileName = `${libraryName}NativeViewConfig.js`;
      const imports: Set<string> = new Set();

      const moduleResults = Object.keys(schema.modules)
        .map(moduleName => {
          const module = schema.modules[moduleName];
          if (module.type !== 'Component') {
            return;
          }

          const {components} = module;

          return Object.keys(components)
            .map((componentName: string) => {
              const component = components[componentName];

              if (component.paperComponentNameDeprecated) {
                imports.add(UIMANAGER_IMPORT);
              }

              const replacedTemplate = ComponentTemplate({
                componentName,
                paperComponentName: component.paperComponentName,
                paperComponentNameDeprecated:
                  component.paperComponentNameDeprecated,
              });

              const paperComponentName =
                component.paperComponentName ?? componentName;

              const replacedSourceRoot = core.template.program(
                replacedTemplate,
              )({
                VIEW_CONFIG: buildViewConfig(
                  schema,
                  paperComponentName,
                  component,
                  imports,
                ),
              });

              const commandsExport = buildCommands(
                schema,
                paperComponentName,
                component,
                imports,
              );
              if (commandsExport) {
                replacedSourceRoot.body.push(commandsExport);
              }

              const replacedSource = core.transformFromAstSync(
                replacedSourceRoot,
                undefined,
                {
                  babelrc: false,
                  browserslistConfigFile: false,
                  configFile: false,
                },
              );
              return replacedSource.code;
            })
            .join('\n\n');
        })
        .filter(Boolean)
        .join('\n\n');

      const replacedTemplate = FileTemplate({
        componentConfig: moduleResults,
        imports: Array.from(imports).sort().join('\n'),
      });

      return new Map([[fileName, replacedTemplate]]);
    } catch (error) {
      console.error(`\nError parsing schema for ${libraryName}\n`);
      console.error(JSON.stringify(schema));
      throw error;
    }
  },
};
