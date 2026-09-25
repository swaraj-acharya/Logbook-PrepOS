/* =====================================================================
   SEED DATA — GATE EE template (editable). Planned shares are starting
   estimates for time balance, not official weightage.
   ===================================================================== */
export const PALETTE = ['#2447C8', '#0E7C86', '#8A4FBF', '#C2410C', '#15803D', '#B8336A', '#A16207', '#475569', '#0369A1', '#9F1239', '#4D7C0F', '#6D28D9'];

// [subject, importance 1-3, planned share %, [[topic, [concepts]]]]
export const SEED_EE = [
  ['Engineering Mathematics', 3, 13, [
    ['Linear Algebra', ['Matrix algebra', 'Systems of linear equations', 'Eigenvalues and eigenvectors']],
    ['Calculus', ['Mean value theorems', 'Definite and improper integrals', 'Partial derivatives', 'Maxima and minima', 'Multiple integrals', 'Fourier series', 'Vector identities and directional derivatives', 'Line, surface and volume integrals', "Stokes, Gauss and Green's theorems"]],
    ['Differential Equations', ['First-order equations (linear and nonlinear)', 'Higher-order linear ODEs with constant coefficients', 'Cauchy–Euler equation', 'Variation of parameters', 'PDEs and separation of variables', 'Initial and boundary value problems']],
    ['Complex Variables', ['Analytic functions', "Cauchy's integral theorem and formula", 'Taylor and Laurent series', 'Residue theorem']],
    ['Probability and Statistics', ['Sampling theorems', 'Conditional probability', 'Mean, median, mode and standard deviation', 'Random variables', 'Poisson, normal and binomial distributions', 'Correlation and regression']]]],
  ['Electric Circuits', 3, 10, [
    ['Network elements', ['Ideal voltage and current sources', 'Dependent sources', 'R, L, C and mutual inductance']],
    ['Network analysis', ['KCL and KVL', 'Node and mesh analysis', 'Star–delta transformation']],
    ['Network theorems', ['Thevenin and Norton', 'Superposition', 'Maximum power transfer']],
    ['Transients', ['Transient response of DC networks', 'Transient response of AC networks']],
    ['AC steady state', ['Phasors and sinusoidal steady state', 'Resonance', 'Complex power and power factor', 'Balanced three-phase circuits']],
    ['Two-port networks', ['Two-port parameters']]]],
  ['Electromagnetic Fields', 2, 4, [
    ['Electrostatics', ["Coulomb's law and electric field intensity", "Electric flux density and Gauss's law", 'Divergence', 'Fields and potential of point, line, plane and spherical charges', 'Effect of dielectric medium', 'Capacitance of simple configurations']],
    ['Magnetostatics', ['Biot–Savart law', "Ampère's law and curl", "Faraday's law", 'Lorentz force', 'Self and mutual inductance', 'MMF, reluctance and magnetic circuits']]]],
  ['Signals and Systems', 3, 7, [
    ['Signals', ['Continuous and discrete-time signals', 'Shifting and scaling', 'RMS and average value of periodic waveforms']],
    ['Systems', ['LTI and causal systems']],
    ['Fourier analysis', ['Fourier series of periodic signals', 'Fourier transform applications', 'Sampling theorem']],
    ['Transforms', ['Laplace transform', 'z-transform']]]],
  ['Electrical Machines', 3, 12, [
    ['Single-phase transformer', ['Equivalent circuit and phasor diagram', 'Open-circuit and short-circuit tests', 'Voltage regulation', 'Transformer efficiency']],
    ['Three-phase transformers', ['Connections and vector groups', 'Parallel operation of transformers', 'Auto-transformer']],
    ['Energy conversion', ['Electromechanical energy conversion principles']],
    ['DC machines', ['Separately excited, series and shunt machines', 'Motoring and generating characteristics', 'Speed control of DC motors']],
    ['Induction machines', ['Induction motor principle and types', 'Induction motor equivalent circuit', 'Torque–speed characteristics', 'No-load and blocked-rotor tests', 'Starting and speed control', 'Single-phase induction motor principle']],
    ['Synchronous machines', ['Cylindrical and salient pole machines', 'Synchronous machine performance and characteristics', 'Regulation of alternators', 'Parallel operation of alternators', 'Starting of synchronous motors']],
    ['Losses and efficiency', ['Losses and efficiency of machines']]]],
  ['Power Systems', 3, 11, [
    ['Generation and transmission', ['Power generation concepts', 'AC and DC transmission concepts', 'Transmission line models and performance', 'Cables']],
    ['Compensation and insulation', ['Series and shunt compensation', 'Electric field distribution and insulators']],
    ['Distribution and per-unit', ['Distribution systems', 'Per-unit quantities']],
    ['Load flow', ['Bus admittance matrix', 'Gauss–Seidel load flow', 'Newton–Raphson load flow']],
    ['Operation and control', ['Voltage and frequency control', 'Power factor correction', 'Economic load dispatch']],
    ['Fault analysis', ['Symmetrical components', 'Symmetrical fault analysis', 'Unsymmetrical fault analysis']],
    ['Protection', ['Overcurrent protection', 'Differential protection', 'Directional protection', 'Distance protection', 'Circuit breakers']],
    ['Stability', ['System stability concepts', 'Equal area criterion']]]],
  ['Control Systems', 3, 8, [
    ['Modeling', ['Mathematical modeling of systems', 'Feedback principle', 'Transfer function', 'Block diagrams', 'Signal flow graphs']],
    ['Time response', ['Transient response of LTI systems', 'Steady-state error']],
    ['Stability', ['Routh–Hurwitz criterion', 'Nyquist criterion', 'Root locus']],
    ['Frequency response', ['Bode plots']],
    ['Compensators and controllers', ['Lag, lead and lead–lag compensators', 'P, PI and PID controllers']],
    ['State space', ['State-space models', 'Solution of state equations']]]],
  ['Analog and Digital Electronics', 2, 8, [
    ['Diode circuits', ['Clipping and clamping', 'Rectifiers']],
    ['Amplifiers', ['Amplifier biasing', 'Equivalent circuits and frequency response', 'Feedback amplifiers', 'Oscillators']],
    ['Operational amplifiers', ['Op-amp characteristics and applications', 'Single-stage active filters', 'Sallen–Key and Butterworth filters', 'VCOs and timers']],
    ['Digital circuits', ['Combinational logic circuits', 'Sequential logic circuits', 'Multiplexers and demultiplexers', 'Schmitt triggers', 'Sample-and-hold circuits', 'A/D and D/A converters']]]],
  ['Power Electronics', 3, 8, [
    ['Devices', ['Static V–I characteristics of thyristor, MOSFET and IGBT', 'Firing and gating circuits']],
    ['DC–DC converters', ['Buck converter', 'Boost converter', 'Buck–boost converter']],
    ['AC–DC converters', ['Uncontrolled rectifiers (1-phase and 3-phase)', 'Thyristor-based converters', 'Bidirectional AC–DC voltage source converters']],
    ['Harmonics', ['Line current harmonics', 'Power factor and distortion factor of AC–DC converters']],
    ['Inverters', ['Voltage and current source inverters', 'Sinusoidal PWM']]]],
  ['Electrical and Electronic Measurements', 2, 4, [
    ['Measurement methods', ['Bridges and potentiometers', 'Measurement of voltage, current, power, energy and power factor', 'Instrument transformers']],
    ['Instruments', ['Digital voltmeters and multimeters', 'Phase, time and frequency measurement', 'Oscilloscopes']],
    ['Accuracy', ['Error analysis']]]],
  ['General Aptitude', 3, 15, [
    ['Verbal aptitude', ['Grammar', 'Vocabulary', 'Reading comprehension', 'Narrative sequencing']],
    ['Quantitative aptitude', ['Data interpretation', 'Numerical computation and estimation', 'Mensuration and geometry', 'Elementary statistics and probability']],
    ['Analytical aptitude', ['Logic: deduction and induction', 'Analogy', 'Numerical relations and reasoning']],
    ['Spatial aptitude', ['Transformation of shapes', 'Paper folding and cutting', '2D and 3D patterns']]]]
];

// concept -> prerequisite concepts (by name, resolved at seed time)
export const SEED_PREREQ = {
  'KCL and KVL': [],
  'Node and mesh analysis': ['KCL and KVL'],
  'Thevenin and Norton': ['Node and mesh analysis'],
  'Complex power and power factor': ['Phasors and sinusoidal steady state'],
  'Balanced three-phase circuits': ['Phasors and sinusoidal steady state'],
  'Transient response of DC networks': ['KCL and KVL', 'First-order equations (linear and nonlinear)'],
  'Equivalent circuit and phasor diagram': ['Phasors and sinusoidal steady state', 'MMF, reluctance and magnetic circuits'],
  'Open-circuit and short-circuit tests': ['Equivalent circuit and phasor diagram'],
  'Voltage regulation': ['Equivalent circuit and phasor diagram', 'Open-circuit and short-circuit tests'],
  'Transformer efficiency': ['Open-circuit and short-circuit tests'],
  'Induction motor equivalent circuit': ['Equivalent circuit and phasor diagram'],
  'Torque–speed characteristics': ['Induction motor equivalent circuit'],
  'Regulation of alternators': ['Synchronous machine performance and characteristics', 'Phasors and sinusoidal steady state'],
  'Bus admittance matrix': ['Node and mesh analysis'],
  'Gauss–Seidel load flow': ['Bus admittance matrix'],
  'Newton–Raphson load flow': ['Bus admittance matrix', 'Systems of linear equations'],
  'Symmetrical components': ['Balanced three-phase circuits'],
  'Symmetrical fault analysis': ['Per-unit quantities', 'Thevenin and Norton'],
  'Unsymmetrical fault analysis': ['Symmetrical components', 'Per-unit quantities'],
  'Power factor correction': ['Complex power and power factor'],
  'Equal area criterion': ['System stability concepts'],
  'Laplace transform': ['Higher-order linear ODEs with constant coefficients'],
  'Transfer function': ['Laplace transform'],
  'Routh–Hurwitz criterion': ['Transfer function'],
  'Root locus': ['Transfer function'],
  'Bode plots': ['Transfer function'],
  'Nyquist criterion': ['Bode plots'],
  'Solution of state equations': ['State-space models', 'Eigenvalues and eigenvectors', 'Laplace transform'],
  'Line current harmonics': ['Fourier series of periodic signals'],
  'Sinusoidal PWM': ['Voltage and current source inverters'],
  'Boost converter': ['Buck converter'],
  'Buck–boost converter': ['Buck converter', 'Boost converter']
};

// Recommended subject order: prerequisite logic, with Aptitude as a parallel track.
export const ROADMAP_ORDER = ['Engineering Mathematics', 'Electric Circuits', 'Electromagnetic Fields', 'Signals and Systems', 'Electrical Machines', 'Power Systems', 'Control Systems', 'Analog and Digital Electronics', 'Power Electronics', 'Electrical and Electronic Measurements', 'General Aptitude'];
export const ROADMAP_WHY = {
  'Engineering Mathematics': 'Linear algebra, calculus and ODEs feed circuits, signals and control. Complex variables and probability can come later.',
  'Electric Circuits': 'Phasors, network theorems and three-phase circuits underpin machines, power systems and power electronics.',
  'Electromagnetic Fields': 'Magnetic circuits and inductance are the physics behind transformers and machines.',
  'Signals and Systems': 'Laplace and Fourier tools are needed for control systems and converter harmonics.',
  'Electrical Machines': 'Needs circuits and magnetic circuits. Power systems uses its machine models.',
  'Power Systems': 'Builds on per-unit, three-phase circuits and machine models.',
  'Control Systems': 'Builds on Laplace transforms and linear algebra.',
  'Analog and Digital Electronics': 'Largely self-contained; diode basics help power electronics.',
  'Power Electronics': 'Uses circuits, device basics and Fourier analysis of harmonics.',
  'Electrical and Electronic Measurements': 'Light and mostly self-contained once circuits are solid.',
  'General Aptitude': 'Parallel track: 10–15 minutes on most days rather than one late block.'
};

export const EVIDENCE = [
  { p: 'Retrieval practice (testing effect)', s: 'Strong', e: 'Recalling information strengthens later retention more than restudying it. Supported across many studies and meta-analyses; rated high utility in a major review of study techniques.', src: 'Roediger & Karpicke (2006), Psychological Science. Rowland (2014), Psychological Bulletin. Adesope, Trevisan & Sundararajan (2017), Review of Educational Research. Dunlosky et al. (2013), Psychological Science in the Public Interest.', f: 'Reviews hide the answer first. After every session the app offers “Recall now”.' },
  { p: 'Spacing and distributed practice', s: 'Strong', e: 'Spreading practice over time beats massing it. The best gap grows with how long you need to remember.', src: 'Cepeda et al. (2006), Psychological Bulletin. Cepeda et al. (2008), Psychological Science. Dunlosky et al. (2013).', f: 'Adaptive review dates per concept, capped so a review lands before your exam.' },
  { p: 'Successive relearning', s: 'Strong', e: 'Retrieving to a correct answer, then repeating that across spaced sessions, produces durable and efficient learning.', src: 'Rawson & Dunlosky (2011), Journal of Experimental Psychology: General. Rawson, Dunlosky & Sciartelli (2013), Educational Psychology Review.', f: 'Missed items come back later in the same review and again on later days.' },
  { p: 'Feedback after retrieval', s: 'Strong', e: 'Feedback, especially after errors, improves what is retained; it works best when it tells you what to change.', src: 'Hattie & Timperley (2007), Review of Educational Research. Butler & Roediger (2008), Memory & Cognition.', f: 'Reveal-and-compare on every card; corrected reasoning stored with each mistake.' },
  { p: 'Interleaving', s: 'Moderate, conditional', e: 'Mixing problem types helps you learn to tell similar problems apart. Benefits depend on the material and are strongest for easily confused categories.', src: 'Rohrer & Taylor (2007), Instructional Science. Brunmair & Richter (2019), Psychological Bulletin.', f: 'Mixed practice and mixed review, used only after concepts have been learned once.' },
  { p: 'Self-explanation and elaboration', s: 'Moderate', e: 'Explaining why and how, in your own words, improves understanding and transfer.', src: 'Chi et al. (1994), Cognitive Science. Bisra et al. (2018), Educational Psychology Review. Dunlosky et al. (2013).', f: 'Teach-back: explain a concept without notes, then see what you missed.' },
  { p: 'Generation effect', s: 'Moderate', e: 'Information you produce yourself is remembered better than information you only read.', src: 'Slamecka & Graf (1978), Journal of Experimental Psychology: Human Learning and Memory. Bertsch et al. (2007), Memory & Cognition.', f: 'Write your answer before revealing. Write your own recall prompts.' },
  { p: 'Learning from errors', s: 'Moderate', e: 'Errors followed by corrective feedback can improve learning; high-confidence errors are often corrected especially well.', src: 'Metcalfe (2017), Annual Review of Psychology. Butterfield & Metcalfe (2001), Journal of Experimental Psychology: Learning, Memory, and Cognition.', f: 'Mistake notebook with typed causes and staged retries.' },
  { p: 'Metacognition and calibration', s: 'Moderate', e: 'Learners often misjudge what they know and which strategies work; overconfidence leads to stopping study too early.', src: 'Kornell & Bjork (2008), Psychological Science. Dunlosky & Rawson (2012), Learning and Instruction.', f: 'Confidence rating before reveal; calibration chart in Insights.' },
  { p: 'Worked examples, cognitive load, expertise reversal', s: 'Moderate', e: 'Worked examples help novices; as expertise grows, independent problem solving becomes more useful.', src: 'Sweller, van Merriënboer & Paas (1998; 2019), Educational Psychology Review. Kalyuga et al. (2003), Educational Psychologist.', f: 'Practice ladder: basic, standard, advanced, unfamiliar problems.' },
  { p: 'Transfer of learning', s: 'Mixed', e: 'Retrieval practice transfers to new questions moderately; transfer is not automatic.', src: 'Pan & Rickard (2018), Psychological Bulletin. Barnett & Ceci (2002), Psychological Bulletin.', f: '“Applied” requires success on advanced or unfamiliar problems, not only recall.' },
  { p: 'Forgetting curves', s: 'Strong (existence); model form approximate', e: 'Memory declines quickly at first, then more slowly. Exact curves vary by person and material.', src: 'Ebbinghaus (1885). Murre & Dros (2015), PLoS ONE.', f: 'Estimated recall percentage per concept, shown as an estimate.' },
  { p: 'Desirable difficulties', s: 'Framework', e: 'Conditions that feel harder (spacing, testing, interleaving) often produce better long-term learning than conditions that feel fluent.', src: 'Bjork (1994). Bjork & Bjork (2011).', f: 'The app does not treat “it felt easy” as evidence of learning.' },
  { p: 'Rereading and highlighting', s: 'Low utility as a main strategy', e: 'Rated low utility when used alone. Reading is still how you first meet material, so the app tracks it without judging it.', src: 'Dunlosky et al. (2013).', f: 'Insights shows how your time splits between taking in, making, and retrieving.' }
];

export const HEURISTICS = [
  ['Review scheduler', 'Uses the FSRS v4.5 formula structure with its default starting weights (Ye, Su & Cao, KDD 2022 describes the underlying approach). The weights were fitted on general flashcard users, not on you or on GATE material. Estimates should be read as approximate.'],
  ['Estimated recall %', 'A model estimate from your review history. It is not the exact probability that you will remember something.'],
  ['Estimated mastery', 'Weighted blend: retrieval accuracy 30%, application accuracy 25%, current recall 20%, stability 15%, confidence calibration 10%. Missing parts are left out. Needs at least two data points; evidence level is shown beside it.'],
  ['Concept states', 'Thresholds for Understood, Retrieved, Practiced, Applied, Stable and Mastered are product rules. Time studied alone never moves a concept past Exposed.'],
  ['Daily plan mix', 'Early (more than 180 days out) leans to new learning; middle (60–180) balances; final (under 60) leans to revision, practice and mistakes. The split is editable in Settings.'],
  ['Review priority', 'Overdue ratio, forgetting risk, importance, prerequisite status and lapses, with editable weights.'],
  ['Exam-aware cap', 'No review interval is allowed to jump past the last days before your exam.'],
  ['Importance and retention', 'High-importance concepts target slightly higher recall (0.93 by default); low-importance ones slightly lower (0.85).'],
  ['Idle detection', 'If the device sleeps or the page is closed for longer than your idle threshold while a timer runs, you choose whether that gap counts.'],
  ['Roadmap order', 'Based on prerequisite relationships in the syllabus, not on an experiment.'],
  ['Mistake retry stages', '1 day, 3 days, 7 days (a similar problem), 21 days. A failed retry restarts at 1 day.']
];

export const DATA_MODEL_TS = `type ID = string;
type StudyMode = "lecture" | "reading" | "notes" | "recall" | "practice"
  | "revision" | "mistakes" | "teachback" | "mock" | "mixed";
type TimerStyle = "stopwatch" | "focus" | "pomodoro" | "deep" | "recall" | "practice" | "mock";

type Exam = { id: ID; name: string; date?: string /* YYYY-MM-DD */; archived?: boolean };

// One tree for every exam: subject > topic > subtopic > concept.
// A subject can belong to several exams (canonical concepts, exam relevance per subject).
type SyllabusNode = {
  id: ID; kind: "subject" | "topic" | "subtopic" | "concept"; parentId?: ID;
  name: string; order: number; archived?: boolean;
  examIds?: ID[]; color?: string; share?: number /* planned % */;
  imp?: 1 | 2 | 3 /* importance */; desc?: string;
  prereq?: ID[]; notes?: string; formula?: string;
  resources?: { id: ID; title: string; url?: string }[];
};

type StudySession = {
  id: ID; examId?: ID;
  subjectId: ID | null /* null = mixed */; topicId?: ID; subtopicId?: ID; conceptIds: ID[];
  startedAt: number; endedAt: number;           // epoch ms; time derived from timestamps
  elapsedSec: number;                           // wall clock
  pausedSec: number; breakSec: number;          // manual pauses, scheduled breaks
  idleExcludedSec: number;                      // sleep/closed gaps you chose to exclude
  focusSec: number;                             // primary analytics value
  selfReportedSec?: number;                     // never overwrites focusSec
  split: { s: ID | null; t?: ID; u?: ID; c?: ID; sec: number }[]; // time attribution
  mode: StudyMode; timerStyle: TimerStyle; targetSec?: number;
  source: "timer" | "manual" | "imported"; edited?: boolean; originalFocusSec?: number;
  questionsSolved?: number; questionsCorrect?: number;
  confidenceBefore?: number; confidenceAfter?: number; focusRating?: number; difficultyRating?: number;
  notes?: string; understood?: string; difficult?: string; planBlock?: string;
  status: "completed" | "stopped" | "discarded";
};

type MemoryRecord = {            // per concept
  S?: number; D?: number;        // stability (days), difficulty (1-10)
  last?: number; due: number; ivl?: number;
  reps: number; lapses: number; ok: number; fail: number;
  state: "new" | "review" | "relearning"; first?: number;
};

type RecallAttempt = {           // review log
  id: ID; cid: ID; at: number; g: 1 | 2 | 3 | 4;   // Again, Hard, Good, Easy
  o?: "correct" | "partial" | "incorrect"; hint?: boolean;
  rt?: number /* sec */; cf?: number /* confidence 1-5 */;
  R?: number /* estimated recall before review */; S: number; ivl: number; mixed?: boolean;
};

type PracticeAttempt = { id: ID; cid: ID; at: number; n: number; c: number;
  lv: "basic" | "standard" | "advanced" | "unfamiliar"; sessionId?: ID };

type Mistake = { id: ID; cid?: ID; at: number; question: string;
  type: "concept" | "formula" | "calculation" | "unit" | "sign" | "misreading"
      | "reasoning" | "memory" | "time" | "careless" | "guess";
  why?: string; fix?: string; remember?: string; conf?: number;
  stage: 0 | 1 | 2 | 3; next: number; resolved?: boolean;
  retries: { at: number; ok: boolean; stage: number }[] };

type RecallPrompt = { id: ID; kind: "free" | "formula" | "blank" | "explain" | "compare"
  | "diagram" | "application" | "problem"; q: string; a?: string };

type TeachBack = { id: ID; cid: ID; at: number; text: string; score?: number;
  correct?: string[]; missing?: string[]; misconceptions?: string[]; next?: string };

type DailyPlan = { date: string; avail: number; base: number;
  blocks: { key: string; kind: string; min: number; title: string; cids: ID[]; mids: ID[] }[];
  progress: Record<string, number> };`;

export const ARCH_NOTES = [
  ['Storage', 'Your data is a set of JSON files in your own GitHub repository, under data/users/<your id>/: core.json (settings, syllabus, memory, running timer, plan), one sessions file per month (ses-YYYY-MM.json), one reviews-and-practice file per month (rev-), one mistakes file per month (mis-), one teach-back file per month (tb-) and recall prompts per subject (pr-). A copy is kept in this browser so the app opens instantly and works offline; changes are batched into one commit every few seconds.'],
  ['Conflicts between devices', 'Each save names the file version it was based on. If another device changed that file first, the server returns the newer copy; sessions, reviews, practice and mistakes are merged item by item, and review memory is merged per concept, so nothing studied on either device is lost.'],
  ['Timer reliability', 'The timer stores its start timestamp, pause totals and a heartbeat. Elapsed time is always derived from timestamps, never from counting ticks, so refreshes, route changes and background tabs do not lose time. Sleep or closed-page gaps longer than your idle threshold are flagged for you to keep, remove or cut.'],
  ['Analytics', 'Sessions roll up into daily totals once; weekly, monthly and custom ranges sum those daily totals.'],
  ['AI', 'The coach, teach-back feedback, prompt drafting and natural-language logging call the Anthropic API from the server with a compact summary of your data. The API key never reaches the browser. Answers are checked against your stored data where possible and never change your study time.'],
  ['Code layout', 'lib/engine.js holds the scheduler, mastery, planner and parser as pure functions with tests. lib/storage holds the GitHub and local-file stores behind one interface. client/ui.js is the browser UI. app/api holds the sync, AI and sign-in routes.']
];
