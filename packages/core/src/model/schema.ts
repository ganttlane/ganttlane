/**
 * Runtime shape of the input data: valibot schemas for `Task` and
 * `Link`. They check the **shape** only (types of fields, allowed literals); domain rules
 * (real dates, durations, alignment, references, cycles) are plain code in normalization and in
 * later modules. A type test keeps `v.InferInput` of each schema equal to the hand-written type.
 *
 * Numbers in date, duration and lag fields may be `NaN` here, so normalization reports them as
 * `'invalid-date'` / `'invalid-duration'` with a precise message instead of a shape error.
 *
 * Planned public entry: `@ganttlane/core/schema`, where callers can
 * validate API data and extend the payload: `v.object({ ...TaskSchema.entries, data: MySchema })`.
 * The explicit schema types below are required by `isolatedDeclarations`.
 */

import * as v from 'valibot';

type Optional<TSchema extends v.GenericSchema> = v.OptionalSchema<TSchema, undefined>;
type ExactOptional<TSchema extends v.GenericSchema> = v.ExactOptionalSchema<TSchema, undefined>;
type Literals<TOptions extends v.PicklistOptions> = v.PicklistSchema<TOptions, undefined>;
type StringS = v.StringSchema<undefined>;
type NumberS = v.NumberSchema<undefined>;
type BooleanS = v.BooleanSchema<undefined>;
/** Any number, `NaN` included (left to the domain parsers). */
type AnyNumberS = v.CustomSchema<number, undefined>;
type TaskIdS = v.UnionSchema<readonly [StringS, NumberS], undefined>;
type LinkTypeS = Literals<readonly ['FS', 'SS', 'FF', 'SF']>;
type DateInputS = v.UnionSchema<
  readonly [StringS, AnyNumberS, v.InstanceSchema<DateConstructor, undefined>],
  undefined
>;
type DurationFieldsS = v.ObjectSchema<
  {
    readonly years: ExactOptional<NumberS>;
    readonly quarters: ExactOptional<NumberS>;
    readonly months: ExactOptional<NumberS>;
    readonly weeks: ExactOptional<NumberS>;
    readonly days: ExactOptional<NumberS>;
    readonly hours: ExactOptional<NumberS>;
    readonly minutes: ExactOptional<NumberS>;
  },
  undefined
>;
/** A number of days or a `DurationInput` (task `duration`, link `lag`). */
type DaysOrDurationS = v.UnionSchema<readonly [AnyNumberS, StringS, DurationFieldsS], undefined>;
type EditingFlagsS = v.ObjectSchema<
  {
    readonly move: Optional<BooleanS>;
    readonly resize: Optional<BooleanS>;
    readonly progress: Optional<BooleanS>;
    readonly links: Optional<BooleanS>;
  },
  undefined
>;
type TaskDependencyS = v.ObjectSchema<
  {
    readonly id: TaskIdS;
    readonly type: Optional<LinkTypeS>;
    readonly lag: Optional<DaysOrDurationS>;
  },
  undefined
>;

const LINK_TYPES: readonly ['FS', 'SS', 'FF', 'SF'] = ['FS', 'SS', 'FF', 'SF'];

const string: StringS = v.string();
const number: NumberS = v.number();
const boolean: BooleanS = v.boolean();
const anyNumber: AnyNumberS = v.custom<number>((input) => typeof input === 'number');
const taskId: TaskIdS = v.union([string, number]);
const linkType: LinkTypeS = v.picklist(LINK_TYPES);
const daysOrDuration: DaysOrDurationS = v.union([
  anyNumber,
  string,
  v.object({
    years: v.exactOptional(number),
    quarters: v.exactOptional(number),
    months: v.exactOptional(number),
    weeks: v.exactOptional(number),
    days: v.exactOptional(number),
    hours: v.exactOptional(number),
    minutes: v.exactOptional(number),
  }),
]);
const optionalString: Optional<StringS> = v.optional(string);
const optionalBoolean: Optional<BooleanS> = v.optional(boolean);

/**
 * Shape of a `Task`. Unknown keys are allowed (and stripped from the parse
 * output); `data` is `unknown`, narrow it with your own schema.
 */
export const TaskSchema: v.ObjectSchema<
  {
    readonly id: TaskIdS;
    readonly name: StringS;
    readonly start: Optional<DateInputS>;
    readonly end: Optional<DateInputS>;
    readonly duration: Optional<DaysOrDurationS>;
    readonly precision: Optional<Literals<readonly ['day', 'time']>>;
    readonly durationMode: Optional<Literals<readonly ['calendar', 'working']>>;
    readonly progress: Optional<NumberS>;
    readonly progressAnchor: Optional<Literals<readonly ['start', 'end']>>;
    readonly type: Optional<Literals<readonly ['task', 'milestone', 'placeholder']>>;
    readonly parentId: Optional<TaskIdS>;
    readonly parentAnchor: Optional<
      v.UnionSchema<readonly [LinkTypeS, v.ArraySchema<LinkTypeS, undefined>], undefined>
    >;
    readonly followParent: Optional<BooleanS>;
    readonly locked: Optional<BooleanS>;
    readonly fixedDuration: Optional<BooleanS>;
    readonly linkable: Optional<BooleanS>;
    readonly editable: Optional<v.UnionSchema<readonly [BooleanS, EditingFlagsS], undefined>>;
    readonly className: Optional<StringS>;
    readonly rowClassName: Optional<StringS>;
    readonly color: Optional<StringS>;
    readonly progressColor: Optional<StringS>;
    readonly description: Optional<StringS>;
    readonly dependencies: Optional<
      v.ArraySchema<v.UnionSchema<readonly [TaskIdS, TaskDependencyS], undefined>, undefined>
    >;
    readonly data: Optional<v.UnknownSchema>;
  },
  undefined
> = v.object({
  id: taskId,
  name: string,
  start: v.optional(v.union([string, anyNumber, v.instance(Date)])),
  end: v.optional(v.union([string, anyNumber, v.instance(Date)])),
  duration: v.optional(daysOrDuration),
  precision: v.optional(v.picklist(['day', 'time'])),
  durationMode: v.optional(v.picklist(['calendar', 'working'])),
  progress: v.optional(number),
  progressAnchor: v.optional(v.picklist(['start', 'end'])),
  type: v.optional(v.picklist(['task', 'milestone', 'placeholder'])),
  parentId: v.optional(taskId),
  parentAnchor: v.optional(v.union([linkType, v.array(linkType)])),
  followParent: optionalBoolean,
  locked: optionalBoolean,
  fixedDuration: optionalBoolean,
  linkable: optionalBoolean,
  editable: v.optional(
    v.union([
      boolean,
      v.object({
        move: optionalBoolean,
        resize: optionalBoolean,
        progress: optionalBoolean,
        links: optionalBoolean,
      }),
    ]),
  ),
  className: optionalString,
  rowClassName: optionalString,
  color: optionalString,
  progressColor: optionalString,
  description: optionalString,
  dependencies: v.optional(
    v.array(
      v.union([
        taskId,
        v.object({ id: taskId, type: v.optional(linkType), lag: v.optional(daysOrDuration) }),
      ]),
    ),
  ),
  data: v.optional(v.unknown()),
});

/** Shape of a `Link`. Unknown keys are allowed. */
export const LinkSchema: v.ObjectSchema<
  {
    readonly id: Optional<StringS>;
    readonly source: TaskIdS;
    readonly target: TaskIdS;
    readonly type: Optional<LinkTypeS>;
    readonly lag: Optional<DaysOrDurationS>;
    readonly editable: Optional<BooleanS>;
  },
  undefined
> = v.object({
  id: optionalString,
  source: taskId,
  target: taskId,
  type: v.optional(linkType),
  lag: v.optional(daysOrDuration),
  editable: optionalBoolean,
});
