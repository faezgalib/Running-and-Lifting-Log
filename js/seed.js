// Exercise library defaults and name-based classification.
import { uid } from './util.js';

// format: wr = weight + reps, r = reps only, hold = seconds, dist = metres
// kind:   lift (gets recommendations), core, mobility (show last session only)

const MOBILITY = {
  'Toe Tap': { format: 'r', perSide: true },
  'Hip Flexor Stretch': { format: 'hold', perSide: true },
  'Clamshell': { format: 'r', perSide: true },
  'Lateral Band Walks': { format: 'r', perSide: true },
  'A Skip': { format: 'dist' },
  'B Skip': { format: 'dist' },
  'Knee Raise with Bend': { format: 'r', perSide: true },
  'Single Leg Glute Bridge': { format: 'r', perSide: true },
  'Plank': { format: 'hold' },
  'Side Plank': { format: 'hold', perSide: true },
  'Copenhagen Plank': { format: 'hold', perSide: true },
  'Stretching': { format: 'hold' },
  'Fire Hydrants': { format: 'r', perSide: true },
  'High Knees': { format: 'r' },
  'Glute Bridge': { format: 'r' },
  'Wall Sit': { format: 'hold' },
  'Bird Dog': { format: 'r', perSide: true },
};

const CORE = {
  'Lying Leg Raise': { format: 'r' },
  'Crunch': { format: 'r' },
  'Crunch (Weighted)': { format: 'wr' },
  'Flutter Kicks': { format: 'r' },
  'Elbow to Knee': { format: 'r' },
  'Bicycle Crunch': { format: 'r' },
  'Russian Twist (Bodyweight)': { format: 'r' },
  'Russian Twist (Weighted)': { format: 'wr' },
  'Hanging Leg Raise': { format: 'r' },
  'Dead Bug': { format: 'r' },
  'Mountain Climber': { format: 'r' },
  'Cable Woodchopper': { format: 'wr', perSide: true, equipment: 'cable' },
};

const UNILATERAL = [
  'Concentration Curl', 'Reverse Grip Concentration Curl', 'Single Arm Tricep Extension (Dumbbell)',
  'Single Leg Standing Calf Raise', 'Single Leg Standing Calf Raise (Dumbbell)', 'Bulgarian Split Squat',
  'Bulgarian Split Squat (Dumbbell)', 'Lunge (Dumbbell)', 'Reverse Lunge (Dumbbell)', 'Step Up',
  'Dumbbell Row', 'Bicep Curl (Dumbbell)', 'Shoulder Press (Dumbbell)', 'Lateral Raise (Cable)',
  'Single Arm Cable Row', 'Cable Glute Kickback', 'Single Leg Romanian Deadlift (Dumbbell)', 'Lateral Lunge (Dumbbell)',
];

// Exercises recorded as the total of two dumbbells.
const TOTAL_LOAD = [
  'Standing Calf Raise (Dumbbell)', 'Squat (Dumbbell)', 'Lunge (Dumbbell)', 'Reverse Lunge (Dumbbell)',
  'Romanian Deadlift (Dumbbell)', 'Rear Delt Reverse Fly (Dumbbell)',
  'Bulgarian Split Squat (Dumbbell)', 'Sumo Squat (Dumbbell)', 'Farmers Walk',
];

const BODYWEIGHT_LIFTS = ['Step Up', 'Squat (Bodyweight)', 'Single Leg Standing Calf Raise', 'Bulgarian Split Squat', 'Pull Up', 'Push Up',
  'Chin Up', 'Bench Dip', 'Tibialis Raise'];

// Muscle group where the name alone doesn't tell.
const GROUP_OVERRIDE = {
  'Face Pull (Cable)': 'back', 'Shrug (Dumbbell)': 'back', 'Dumbbell Pullover': 'back',
  'Arnold Press (Dumbbell)': 'shoulders', 'Skull Crusher (Dumbbell)': 'arms', 'Bench Dip': 'arms',
  'Hip Thrust (Dumbbell)': 'legs', 'Hip Abduction (Machine)': 'legs', 'Hip Adduction (Machine)': 'legs',
  'Cable Glute Kickback': 'legs', 'Tibialis Raise': 'legs', 'Chest Fly (Cable)': 'chest',
  'Overhead Triceps Extension (Cable)': 'arms',
};

// Common exercises added in v2.4 (cable, machine, dumbbell, bodyweight), on top of the starter list.
export const ADDED_V24 = [
  'Seated Cable Row', 'Single Arm Cable Row', 'Face Pull (Cable)', 'Straight-Arm Pulldown (Cable)', 'Cable Curl',
  'Overhead Triceps Extension (Cable)', 'Chest Fly (Cable)', 'Cable Woodchopper', 'Cable Glute Kickback',
  'Leg Extension (Machine)', 'Seated Leg Curl (Machine)', 'Hip Abduction (Machine)', 'Hip Adduction (Machine)',
  'Seated Calf Raise (Machine)',
  'Arnold Press (Dumbbell)', 'Hip Thrust (Dumbbell)', 'Single Leg Romanian Deadlift (Dumbbell)', 'Lateral Lunge (Dumbbell)',
  'Shrug (Dumbbell)', 'Skull Crusher (Dumbbell)', 'Dumbbell Pullover', 'Incline Curl (Dumbbell)',
  'Chin Up', 'Bench Dip', 'Hanging Leg Raise', 'Dead Bug', 'Bird Dog', 'Mountain Climber', 'Tibialis Raise',
];

// Names the owner typed for an exercise that now exists under its standard name.
export const ALIASES = { 'row cable': 'Seated Cable Row' };

const GROUP_RULES = [
  [/calf|squat|lunge|leg press|leg curl|deadlift|step up|split|hamstring|leg extension/i, 'legs'],
  [/row|pulldown|pull up|chin|rear delt/i, 'back'],
  [/bench|chest|pec|push up/i, 'chest'],
  [/shoulder|lateral raise|front raise|overhead|plate front/i, 'shoulders'],
  [/curl|tricep|pushdown|wrist|extension/i, 'arms'],
  [/crunch|plank|leg raise|twist|flutter|elbow to knee/i, 'core'],
];

export const GROUPS = ['legs', 'chest', 'back', 'shoulders', 'arms', 'core', 'full body', 'mobility'];

export function equipmentOf(name) {
  if (/\(machine\)/i.test(name)) return 'machine';
  if (/cable|pushdown|pulldown/i.test(name)) return 'cable';
  if (/\(barbell\)/i.test(name)) return 'barbell';
  if (BODYWEIGHT_LIFTS.includes(name) || /\(bodyweight\)/i.test(name) || /pull up|push up|chin up/i.test(name)) return 'bodyweight';
  return 'dumbbell';
}

export const defaultStep = equip => (equip === 'machine' || equip === 'cable' ? 2.5 : equip === 'bodyweight' ? 0 : 1.5);

export function classify(name) {
  const base = {
    id: uid(), name, kind: 'lift', format: 'wr', equipment: 'dumbbell', step: 1.5,
    load: 'single', unilateral: false, perSide: false, group: 'full body', repMin: 8, repMax: 12, archived: false,
  };
  if (MOBILITY[name]) {
    const m = MOBILITY[name];
    return { ...base, kind: 'mobility', format: m.format, perSide: !!m.perSide, unilateral: !!m.perSide, equipment: 'bodyweight', step: 0, group: 'mobility' };
  }
  if (CORE[name]) {
    const c = CORE[name];
    const equipment = c.equipment || (c.format === 'wr' ? 'dumbbell' : 'bodyweight');
    return { ...base, kind: 'core', format: c.format, equipment, step: c.format === 'wr' ? defaultStep(equipment) : 0, group: 'core', unilateral: !!c.perSide };
  }
  const equipment = equipmentOf(name);
  const group = GROUP_OVERRIDE[name] || (GROUP_RULES.find(([re]) => re.test(name)) || [, 'full body'])[1];
  return {
    ...base,
    equipment,
    format: equipment === 'bodyweight' ? 'r' : 'wr',
    step: defaultStep(equipment),
    load: TOTAL_LOAD.includes(name) ? 'total' : 'single',
    unilateral: UNILATERAL.includes(name),
    group,
  };
}

// Starter library: everything the user has mentioned, beyond what a Hevy import brings.
export const STARTER = [...new Set([
  ...Object.keys(MOBILITY), ...Object.keys(CORE),
  'Pull Up', 'Bicep Curl (Dumbbell)', 'Concentration Curl', 'Shoulder Press (Dumbbell)', 'Lateral Raise (Dumbbell)',
  'Bench Press (Dumbbell)', 'Dumbbell Row', 'Romanian Deadlift (Dumbbell)', 'Bulgarian Split Squat (Dumbbell)',
  'Lying Leg Curl (Machine)', 'Squat (Machine)', 'Chest Fly (Machine)', 'Leg Press (Machine)',
  'Seated Shoulder Press (Machine)', 'Chest Press (Machine)', 'Lateral Raise (Cable)',
  ...ADDED_V24,
])];

// Effective weight step for a recommendation (doubles when load is the total of 2 dumbbells).
export const effStep = ex => (ex.step || 0) * (ex.load === 'total' ? 2 : 1);
