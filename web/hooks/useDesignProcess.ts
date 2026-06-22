import { useState, useCallback, useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Task {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  addedAt: number;
}

export interface Phase {
  id: string;
  title: string;
  tasks: Task[];
  /** Phases marked true must all be complete before isReadyToCode becomes true */
  isPreCoding: boolean;
}

export interface ComplexityOption {
  id: string;
  approach: string;
  time: string;
  space: string;
  notes?: string;
}

export interface DesignProcessState {
  problemTitle: string;
  phases: Phase[];
  complexityOptions: ComplexityOption[];
  chosenApproachId: string | null;
  pseudocode: string;
  startedAt: number;
  lastUpdatedAt: number;
}

export interface PhaseMetrics {
  phaseId: string;
  title: string;
  total: number;
  completed: number;
  percentDone: number;
  isDone: boolean;
}

export interface DesignProcessMetrics {
  progressPercent: number;
  phaseMetrics: PhaseMetrics[];
  currentPhase: Phase | null;
  isReadyToCode: boolean;
  elapsedMs: number;
}

export interface DesignProcessActions {
  /** Toggle a task's completed state */
  toggleTask: (phaseId: string, taskId: string) => void;
  /** Add a new task to a phase */
  addTask: (phaseId: string, title: string, description?: string) => void;
  /** Remove a task from a phase */
  removeTask: (phaseId: string, taskId: string) => void;
  /** Update a task's title or description */
  updateTask: (phaseId: string, taskId: string, patch: Partial<Pick<Task, "title" | "description">>) => void;
  /** Add a new phase */
  addPhase: (title: string, isPreCoding?: boolean) => void;
  /** Remove a phase */
  removePhase: (phaseId: string) => void;
  /** Log a complexity option */
  addComplexityOption: (option: Omit<ComplexityOption, "id">) => void;
  /** Remove a complexity option */
  removeComplexityOption: (id: string) => void;
  /** Set the chosen approach by id */
  setChosenApproach: (id: string | null) => void;
  /** Update the pseudocode string */
  setPseudocode: (code: string) => void;
  /** Export a markdown summary of the session */
  exportSummary: () => string;
  /** Reset everything (keeps the problem title) */
  reset: () => void;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function defaultPhases(problemTitle: string): Phase[] {
  return [
    {
      id: uid(),
      title: "Understand the problem",
      isPreCoding: true,
      tasks: [
        { id: uid(), title: "Restate the problem in your own words", completed: false, addedAt: Date.now() },
        { id: uid(), title: "Identify inputs and outputs", completed: false, addedAt: Date.now() },
        { id: uid(), title: "Clarify constraints and edge cases", completed: false, addedAt: Date.now() },
        { id: uid(), title: "Note any assumptions", completed: false, addedAt: Date.now() },
      ],
    },
    {
      id: uid(),
      title: "Work through examples",
      isPreCoding: true,
      tasks: [
        { id: uid(), title: "Trace the basic case", completed: false, addedAt: Date.now() },
        { id: uid(), title: "Trace an edge case (empty / single / large)", completed: false, addedAt: Date.now() },
        { id: uid(), title: "Spot patterns or invariants", completed: false, addedAt: Date.now() },
      ],
    },
    {
      id: uid(),
      title: "Design approach",
      isPreCoding: true,
      tasks: [
        { id: uid(), title: "Brute-force solution identified", completed: false, addedAt: Date.now() },
        { id: uid(), title: "Optimised strategy chosen", completed: false, addedAt: Date.now() },
        { id: uid(), title: "Data structures selected", completed: false, addedAt: Date.now() },
      ],
    },
    {
      id: uid(),
      title: "Complexity analysis",
      isPreCoding: true,
      tasks: [
        { id: uid(), title: "Time complexity logged", completed: false, addedAt: Date.now() },
        { id: uid(), title: "Space complexity logged", completed: false, addedAt: Date.now() },
        { id: uid(), title: "Approach accepted / trade-offs understood", completed: false, addedAt: Date.now() },
      ],
    },
    {
      id: uid(),
      title: "Pseudocode",
      isPreCoding: true,
      tasks: [
        { id: uid(), title: "High-level steps written", completed: false, addedAt: Date.now() },
        { id: uid(), title: "Loop / recursion structure clear", completed: false, addedAt: Date.now() },
      ],
    },
    {
      id: uid(),
      title: "Code",
      isPreCoding: false,
      tasks: [
        { id: uid(), title: "Translate pseudocode to code", completed: false, addedAt: Date.now() },
        { id: uid(), title: "Handle edge cases in code", completed: false, addedAt: Date.now() },
      ],
    },
    {
      id: uid(),
      title: "Test & verify",
      isPreCoding: false,
      tasks: [
        { id: uid(), title: "Run provided examples", completed: false, addedAt: Date.now() },
        { id: uid(), title: "Run custom edge cases", completed: false, addedAt: Date.now() },
        { id: uid(), title: "Dry-run with off-by-one check", completed: false, addedAt: Date.now() },
      ],
    },
  ];
}

function buildInitialState(problemTitle: string): DesignProcessState {
  return {
    problemTitle,
    phases: defaultPhases(problemTitle),
    complexityOptions: [],
    chosenApproachId: null,
    pseudocode: "",
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDesignProcess(problemTitle: string): {
  state: DesignProcessState;
  actions: DesignProcessActions;
  metrics: DesignProcessMetrics;
} {
  const [state, setState] = useState<DesignProcessState>(() => buildInitialState(problemTitle));

  // Utility: stamp lastUpdatedAt on every mutation
  const mutate = useCallback((updater: (prev: DesignProcessState) => DesignProcessState) => {
    setState((prev) => ({ ...updater(prev), lastUpdatedAt: Date.now() }));
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const toggleTask = useCallback((phaseId: string, taskId: string) => {
    mutate((prev) => ({
      ...prev,
      phases: prev.phases.map((ph) =>
        ph.id !== phaseId ? ph : {
          ...ph,
          tasks: ph.tasks.map((t) =>
            t.id !== taskId ? t : { ...t, completed: !t.completed }
          ),
        }
      ),
    }));
  }, [mutate]);

  const addTask = useCallback((phaseId: string, title: string, description?: string) => {
    mutate((prev) => ({
      ...prev,
      phases: prev.phases.map((ph) =>
        ph.id !== phaseId ? ph : {
          ...ph,
          tasks: [...ph.tasks, { id: uid(), title, description, completed: false, addedAt: Date.now() }],
        }
      ),
    }));
  }, [mutate]);

  const removeTask = useCallback((phaseId: string, taskId: string) => {
    mutate((prev) => ({
      ...prev,
      phases: prev.phases.map((ph) =>
        ph.id !== phaseId ? ph : { ...ph, tasks: ph.tasks.filter((t) => t.id !== taskId) }
      ),
    }));
  }, [mutate]);

  const updateTask = useCallback((phaseId: string, taskId: string, patch: Partial<Pick<Task, "title" | "description">>) => {
    mutate((prev) => ({
      ...prev,
      phases: prev.phases.map((ph) =>
        ph.id !== phaseId ? ph : {
          ...ph,
          tasks: ph.tasks.map((t) => t.id !== taskId ? t : { ...t, ...patch }),
        }
      ),
    }));
  }, [mutate]);

  const addPhase = useCallback((title: string, isPreCoding = false) => {
    mutate((prev) => ({
      ...prev,
      phases: [...prev.phases, { id: uid(), title, tasks: [], isPreCoding }],
    }));
  }, [mutate]);

  const removePhase = useCallback((phaseId: string) => {
    mutate((prev) => ({
      ...prev,
      phases: prev.phases.filter((ph) => ph.id !== phaseId),
    }));
  }, [mutate]);

  const addComplexityOption = useCallback((option: Omit<ComplexityOption, "id">) => {
    mutate((prev) => ({
      ...prev,
      complexityOptions: [...prev.complexityOptions, { id: uid(), ...option }],
    }));
  }, [mutate]);

  const removeComplexityOption = useCallback((id: string) => {
    mutate((prev) => ({
      ...prev,
      complexityOptions: prev.complexityOptions.filter((o) => o.id !== id),
      chosenApproachId: prev.chosenApproachId === id ? null : prev.chosenApproachId,
    }));
  }, [mutate]);

  const setChosenApproach = useCallback((id: string | null) => {
    mutate((prev) => ({ ...prev, chosenApproachId: id }));
  }, [mutate]);

  const setPseudocode = useCallback((code: string) => {
    mutate((prev) => ({ ...prev, pseudocode: code }));
  }, [mutate]);

  const exportSummary = useCallback((): string => {
    const s = state; // capture snapshot at call time
    const elapsed = Math.round((Date.now() - s.startedAt) / 1000 / 60);
    const lines: string[] = [
      `# Design Process — ${s.problemTitle}`,
      `> Session time: ${elapsed} min  |  Started: ${new Date(s.startedAt).toLocaleString()}`,
      "",
    ];

    for (const ph of s.phases) {
      const done = ph.tasks.filter((t) => t.completed).length;
      lines.push(`## ${ph.title}  (${done}/${ph.tasks.length})`);
      for (const t of ph.tasks) {
        lines.push(`- [${t.completed ? "x" : " "}] ${t.title}${t.description ? ` — ${t.description}` : ""}`);
      }
      lines.push("");
    }

    if (s.complexityOptions.length > 0) {
      lines.push("## Complexity Options");
      for (const opt of s.complexityOptions) {
        const chosen = opt.id === s.chosenApproachId ? " ✅ chosen" : "";
        lines.push(`### ${opt.approach}${chosen}`);
        lines.push(`- Time: ${opt.time}`);
        lines.push(`- Space: ${opt.space}`);
        if (opt.notes) lines.push(`- Notes: ${opt.notes}`);
        lines.push("");
      }
    }

    if (s.pseudocode.trim()) {
      lines.push("## Pseudocode");
      lines.push("```");
      lines.push(s.pseudocode.trim());
      lines.push("```");
      lines.push("");
    }

    return lines.join("\n");
  }, [state]);

  const reset = useCallback(() => {
    setState(buildInitialState(problemTitle));
  }, [problemTitle]);

  // ── Metrics ────────────────────────────────────────────────────────────────

  const metrics = useMemo<DesignProcessMetrics>(() => {
    const phaseMetrics: PhaseMetrics[] = state.phases.map((ph) => {
      const total = ph.tasks.length;
      const completed = ph.tasks.filter((t) => t.completed).length;
      const percentDone = total === 0 ? 100 : Math.round((completed / total) * 100);
      return { phaseId: ph.id, title: ph.title, total, completed, percentDone, isDone: total > 0 && completed === total };
    });

    const totalTasks = phaseMetrics.reduce((sum, pm) => sum + pm.total, 0);
    const completedTasks = phaseMetrics.reduce((sum, pm) => sum + pm.completed, 0);
    const progressPercent = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

    const preCodingPhases = state.phases.filter((ph) => ph.isPreCoding);
    const isReadyToCode = preCodingPhases.length > 0 &&
      preCodingPhases.every((ph) => ph.tasks.length > 0 && ph.tasks.every((t) => t.completed));

    // currentPhase: the first phase that has incomplete tasks
    const currentPhase = state.phases.find((ph) => ph.tasks.some((t) => !t.completed)) ?? null;

    return {
      progressPercent,
      phaseMetrics,
      currentPhase,
      isReadyToCode,
      elapsedMs: Date.now() - state.startedAt,
    };
  }, [state]);

  const actions: DesignProcessActions = {
    toggleTask,
    addTask,
    removeTask,
    updateTask,
    addPhase,
    removePhase,
    addComplexityOption,
    removeComplexityOption,
    setChosenApproach,
    setPseudocode,
    exportSummary,
    reset,
  };

  return { state, actions, metrics };
}
