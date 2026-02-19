# Resolve Import Test Matrix

## Version Scope
- App target: `1.0.0-beta.1`
- Export format: structured FCPXML
- Events encoded: `01_BLOCKS`, `02_CAMERAS`, `03_SELECTS`, optional `04_MASTER`

## Scenarios
| Scenario | Input Conditions | Export Scope | Expected Resolve Outcome |
|---|---|---|---|
| Single camera | One camera naming pattern, uniform fps | all | Import succeeds, block/camera/select/master events present, one or more timelines created |
| Multi-camera A/B/C | Filenames containing camera labels | all | Camera event includes timelines grouped by inferred labels; block timelines present |
| No audio | Video files without audio tracks | all | Import succeeds; no audio-specific failure; markers and keyword metadata still present |
| Mixed fps/resolution | Mixed stream formats | all | Import succeeds; format resources generated per unique WxH@FPS |
| Picks only | Clips flagged `pick` | picks | Only picked clips in timelines/markers |
| Rating >= N | Mixed ratings | rated_min | Only clips with `rating >= N` present |
| Selected blocks | Blocks selected in UI | selected_blocks | Export contains only clips from selected blocks |
| Empty selection | Scope resolves to zero clips | any | Command returns clean error: no XML generated |

## Naming Expectations
- Block timeline names: `<Project>_Block_XX`
- Camera timeline names: `<Project>_Cam_<Label>`
- Selects timeline names: `<Project>_Picks`, `<Project>_Rating_<N>`
- Master timeline name: `<Project>_Master`

## Marker Expectations
- Pick: marker value `PICK`
- Reject: marker value `REJECT`
- Rating: marker value `★N`
- Notes: marker value contains escaped/truncated note text

## Validation Steps
1. Export FCPXML from each scenario.
2. Import into DaVinci Resolve Media Pool.
3. Confirm event/timeline names.
4. Confirm marker payloads on imported clips.
5. Confirm no malformed XML import errors.
