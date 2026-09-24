import { api } from './client'
import type { Scenario } from './chat'

export interface CustomScenario extends Scenario {
  system_prompt: string
  judge_questions: string
  persona_questions: string
}

export interface ScenarioInput {
  name: string
  description: string
  system_prompt: string
  judge_questions: string
  persona_questions: string
}

export type QuestionKind = 'judge' | 'persona'

export function listAllScenarios() {
  return api.get<CustomScenario[]>('/api/scenarios')
}

export function createScenario(body: ScenarioInput & { base_scenario_id?: number | null }) {
  return api.post<CustomScenario>('/api/scenarios', body)
}

export function updateScenario(id: number, body: ScenarioInput) {
  return api.patch<CustomScenario>(`/api/scenarios/${id}`, body)
}

export function generateScenarioQuestions(body: {
  kind: QuestionKind
  name: string
  description: string
  requirements: string
}) {
  return api.post<{ questions: string }>('/api/scenarios/generate-questions', body)
}

export function deleteScenario(id: number) {
  return api.delete<void>(`/api/scenarios/${id}`)
}
