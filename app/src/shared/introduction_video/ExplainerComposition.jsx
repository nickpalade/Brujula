import { AbsoluteFill, Sequence } from 'remotion'
import { sceneStarts, BG_0 } from './constants.js'
import SceneProblem from './scenes/SceneProblem.jsx'
import SceneIntro from './scenes/SceneIntro.jsx'
import SceneFlow from './scenes/SceneFlow.jsx'
import SceneHuman from './scenes/SceneHuman.jsx'
import SceneClose from './scenes/SceneClose.jsx'

const SCENE_COMPONENTS = {
  problem: SceneProblem,
  intro: SceneIntro,
  flow: SceneFlow,
  human: SceneHuman,
  close: SceneClose,
}

// The composition itself has no interactivity — ExplainerPlayer owns
// play/pause/seek so the same timeline can be scrubbed once nested in the
// real site.
export default function ExplainerComposition() {
  return (
    <AbsoluteFill style={{ backgroundColor: BG_0 }}>
      {sceneStarts().map((s) => {
        const SceneComponent = SCENE_COMPONENTS[s.id]
        return (
          <Sequence key={s.id} from={s.start} durationInFrames={s.frames} name={s.label}>
            <SceneComponent durationInFrames={s.frames} />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
