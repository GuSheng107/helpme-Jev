import { api } from './client'
import type { Scenario } from './chat'

export interface CustomScenario extends Scenario {
  judge_questions: string | null
}

export function listAllScenarios() {
  return api.get<CustomScenario[]>('/api/scenarios')
}

export function createScenario(name: string, baseScenarioId?: number) {
  return api.post<CustomScenario>('/api/scenarios', {
    name,
    base_scenario_id: baseScenarioId ?? null,
  })
}

export function updateScenario(
  id: number,
  body: { name?: string; description?: string; judge_questions?: string },
) {
  return api.patch<CustomScenario>(`/api/scenarios/${id}`, body)
}

export function deleteScenario(id: number) {
  return api.delete<void>(`/api/scenarios/${id}`)
}
