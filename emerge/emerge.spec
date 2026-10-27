// EMERGE CANONICAL SPEC v1.0.0
// UUID: emerge-spec-canonical-v1-0-0
// This file IS the SNR gate's definition of valid signal.
// Edit this file → compiler behavior updates on next run.

version 1.0.0

// ── Root types ────────────────────────────────────────────────────────────────
root Structure
root Signal
root Observation
root Gap
root Record
root Identity

// ── Axioms ────────────────────────────────────────────────────────────────────
axiom NO_SILENT_DROP
axiom SIGNAL_MUST_ROUTE_OR_LOG
axiom GAP_IS_FIRST_CLASS
axiom EXECUTION_IS_TRACEABLE
axiom RECORD_IS_TRUTH
axiom PROOF_REQUIRED_FOR_PROMOTION
axiom GRAMMAR_APPLIES_TO_ITSELF

// ── Domain 1 — Structure ──────────────────────────────────────────────────────
domain "structure"
system      = runtime_environment
core        = immutable_execution_rules
invariant   = always_true
axiom       = global_invariant
maxim       = conditional_invariant
constraint  = local_invariant
component   = transform
framework   = external_executable_component
compartment = bounded_container
seam        = boundary_between_components
edge        = defined_transition_boundary
gate        = execution_control_point

// ── Domain 2 — Signal Physics ─────────────────────────────────────────────────
domain "signal"
signal      = expected_state_transition
state       = current_system_condition
context     = surrounding_runtime_conditions
input       = data
output      = data
flow        = directed_signal_path
feedback    = output_to_input
loop        = repeat_component

// ── Domain 3 — Observation ────────────────────────────────────────────────────
domain "observation"
observer    = monitors_runtime_behavior
baseline    = established_expected_behavior
sigma       = observes_baseline_divergence
delta       = distance_expected_actual
slope       = rate_of_change_delta
polarity    = direction_of_divergence
trend       = trajectory_over_time
observation = sigma_result

// ── Domain 4 — Runtime Physics ───────────────────────────────────────────────
domain "runtime"
coherence   = ability_to_hold_structure
entropy     = structural_disorder
friction    = conflicting_structure
pressure    = significance_of_missing_structure
density     = generative_potential_of_gap
stability   = coherence_over_entropy
sigma_regime = stable
stable      = sigma_regime_stable
degraded    = sigma_regime_degraded
collapsing  = sigma_regime_collapsing
oscillatory = sigma_regime_oscillatory

// ── Domain 5 — Failure ───────────────────────────────────────────────────────
domain "failure"
noise       = invalid_signal
gap         = missing_structure
decay       = temporary_state_expiration
recycle     = decay_preserving_axioms

// ── Domain 6 — Gap Field ─────────────────────────────────────────────────────
domain "gap_field"
gap.logical
gap.evidential
gap.temporal
gap.assumption
gap.contradiction
gap.structural
gap.contextual
gap.causal
uncertainty = unknown_structure
omission    = expected_structure_missing
inference   = implied_structure

// ── Domain 7 — Cognition ─────────────────────────────────────────────────────
domain "cognition"
whatif      = speculative_branch
if          = deterministic_condition
then        = deterministic_outcome
try         = attempt_execution
else        = fallback_execution

// ── Domain 8 — Ledger ────────────────────────────────────────────────────────
domain "ledger"
idea        = speculative_record
upgrade     = validated_record
proof       = typed_validation
ledger      = authoritative_timeline
promote     = idea_to_upgrade
conversion  = ideas_over_upgrades
bottleneck  = unresolved_speculative_load

// ── Domain 9 — Time ──────────────────────────────────────────────────────────
domain "time"
record      = authoritative_sequence
snapshot    = point_in_time_state
clip        = bounded_record_window
replay      = reconstruct_from_record
reconstruct = rebuild_state
fork        = branch_record
lineage     = ancestry_of_record
compress    = encode_record
blueprint   = structural_digest

// ── Domain 10 — Identity ─────────────────────────────────────────────────────
domain "identity"
uuid        = unique_identity
systemid    = first_2_chars
componentid = next_6_chars
shortid     = systemid_plus_componentid

// ── Domain 11 — Persistence ──────────────────────────────────────────────────
domain "persistence"
persist     = write_to_record
restore     = read_from_record
archive     = compress_record

// ── Domain 12 — Invariants / Laws ────────────────────────────────────────────
domain "laws"
law         = derived_theorem
emit        = observable_event
route       = directed_output
log         = append_to_record
halt        = stop_execution
observe     = sigma_call
measure     = quantify_friction
reinject    = feedback_to_input
integrity   = structural_match
fidelity    = behavioral_match
oscillate   = periodic_state
signals     = score_vector

// ── Domain 13 — Type System ───────────────────────────────────────────────────
// Covers field type annotations: field : type syntax
domain "types"
string      = text_value
float       = decimal_value
int         = integer_value
bool        = boolean_value
timestamp   = time_value
list        = ordered_collection
map         = keyed_collection
ring        = bounded_circular_buffer
any         = unconstrained_value
null        = empty_value
required    = must_be_present
optional    = may_be_absent
score       = weighted_composite_value
hash        = cryptographic_digest
semver      = semantic_version_string

// ── Domain 14 — Output / Emit ─────────────────────────────────────────────────
// Covers output declarations in setup and compiler programs
domain "output"
output      = declared_file_target
type        = output_type_declaration
file        = filesystem_artifact
content     = output_content_key
template    = output_template_key
raw         = literal_output_content
emit        = observable_event

// ── Domain 15 — Field Syntax ──────────────────────────────────────────────────
// Covers both = and : field declaration styles
domain "fields"
id          = component_identity_field
uuid        = universal_unique_identity
version     = semver_field
name        = human_readable_name
intent      = declared_purpose
source      = origin_reference
target      = destination_reference
path        = filesystem_or_signal_path
mode        = operational_mode
interval    = timing_period
priority    = execution_priority
reason      = explanation_field
note        = annotation_field
severity    = criticality_level
status      = current_state_field
alive       = liveness_flag
ready       = readiness_flag
running     = execution_state_flag

// ════════════════════════════════════════════════════════════════════════════
// EMERGE SPEC EXTENSION — IDE + VOICE + LLM STREAMING
// version 1.1.0
// All new primitives required before IDE, voice, and AI can be written in .eg
// ════════════════════════════════════════════════════════════════════════════

// ── Domain 16 — Render / UI Primitives ───────────────────────────────────────
domain "render"
render      = produce_visual_output
panel       = bounded_visual_region
layout      = spatial_arrangement_of_panels
cursor      = position_in_editor_signal
selection   = bounded_cursor_range
keybind     = keyboard_input_signal
keydown     = key_pressed_signal
keyup       = key_released_signal
scroll      = viewport_position_signal
focus       = active_panel_signal
blur        = inactive_panel_signal
theme       = visual_style_declaration
syntax      = token_coloring_rules
gutter      = line_number_region
minimap     = compressed_document_overview
tab         = named_panel_tab
split       = panel_division
resize      = panel_boundary_adjustment
tooltip     = contextual_hover_display
modal       = blocking_overlay_panel
toast       = non_blocking_notification
statusbar   = persistent_bottom_panel

// ── Domain 17 — Editor Primitives ────────────────────────────────────────────
domain "editor"
buffer      = mutable_text_content
line        = single_text_row
token       = lexed_text_unit
span        = styled_token_range
decoration  = non_printing_editor_overlay
marker      = position_annotation
diagnostic  = error_or_gap_annotation
fold        = collapsed_region
indent      = leading_whitespace_signal
autocomplete = completion_suggestion_list
hover       = contextual_signal_on_token
goto        = navigation_signal
find        = text_search_signal
replace     = text_mutation_signal
undo        = state_revert_signal
redo        = state_forward_signal
format      = source_normalisation_signal

// ── Domain 18 — Language Server (LSP as seam) ─────────────────────────────────
domain "lsp"
lsp         = language_server_seam
complete    = autocomplete_result
hover_info  = token_documentation
definition  = symbol_definition_location
references  = symbol_usage_locations
rename      = symbol_rename_signal
symbols     = document_symbol_list
diagnostics = gap_and_error_list
codelens    = inline_action_annotation
action      = code_action_signal
workspace   = multi_file_context

// ── Domain 19 — AI Assistance ─────────────────────────────────────────────────
domain "ai"
assist      = ai_suggestion_signal
suggest     = single_ai_suggestion
accept      = suggestion_accepted_signal
reject      = suggestion_rejected_signal
explain     = ai_explanation_signal
refactor    = ai_refactor_signal
generate    = ai_generation_signal
review      = ai_review_signal
context     = ai_prompt_context
prompt      = ai_input_signal
response    = ai_output_signal
token_stream = continuous_token_output
chunk       = single_token_or_word_unit
model       = llm_model_declaration
catalog     = ordered_model_registry
fitness     = model_capability_score
task        = inference_task_type
temperature = sampling_temperature
max_tokens  = output_length_limit
stop        = generation_stop_signal
thinking    = reasoning_trace_signal

// ── Domain 20 — Ollama Seam ───────────────────────────────────────────────────
domain "ollama"
ollama      = local_inference_runtime
pull        = download_model_signal
list        = available_models_signal
run         = inference_execution_signal
stream      = streaming_inference_signal
abort       = cancel_inference_signal
ping        = runtime_health_check
endpoint    = ollama_api_address
model_info  = model_metadata_record

// ── Domain 21 — Voice ─────────────────────────────────────────────────────────
domain "voice"
voice       = audio_input_output_seam
microphone  = audio_capture_device
speaker     = audio_output_device
transcribe  = audio_to_text_transform
synthesize  = text_to_audio_transform
tts         = text_to_speech_signal
stt         = speech_to_text_signal
utterance   = complete_spoken_unit
phrase      = partial_spoken_unit
silence     = audio_gap_signal
vad         = voice_activity_detection
wakeword    = activation_phrase_signal
interim     = partial_transcription_signal
final       = complete_transcription_signal
speak       = tts_output_command
listen      = stt_input_command
mute        = disable_microphone_signal
unmute      = enable_microphone_signal
volume      = audio_level_signal
pitch       = tts_pitch_parameter
rate        = tts_speech_rate_parameter
voice_id    = tts_voice_selection

// ── Domain 22 — Streaming ─────────────────────────────────────────────────────
domain "streaming"
pipe        = continuous_signal_channel
buffer_stream = in_flight_token_accumulator
flush       = emit_buffered_stream_signal
backpressure = stream_flow_control_signal
drain       = consume_all_buffered_signal
watermark   = stream_position_marker
window      = bounded_stream_slice
throttle    = rate_limited_stream_signal
debounce    = delayed_stream_signal

// ── Model Catalog (sorted by fitness per task) ────────────────────────────────
// fitness scores: 0.0 (worst) → 1.0 (best) per task axis
// axes: code_gen, completion, explanation, chat, speed, vram_gb

catalog EMERGE_MODEL_CATALOG {

  model "qwen2.5-coder:1.5b" {
    ollama_id   = qwen2.5-coder:1.5b
    vram_gb     = 1.5
    speed       = 0.98
    code_gen    = 0.72
    completion  = 0.85
    explanation = 0.60
    chat        = 0.55
    best_for    = completions fast_gap_suggestions inline_assist
    fitness     = 0.78
  }

  model "qwen2.5-coder:3b" {
    ollama_id   = qwen2.5-coder:3b
    vram_gb     = 3.0
    speed       = 0.90
    code_gen    = 0.82
    completion  = 0.88
    explanation = 0.74
    chat        = 0.70
    best_for    = code_gen gap_resolution explain_error
    fitness     = 0.83
  }

  model "qwen2.5-coder:7b" {
    ollama_id   = qwen2.5-coder:7b
    vram_gb     = 6.5
    speed       = 0.75
    code_gen    = 0.92
    completion  = 0.90
    explanation = 0.88
    chat        = 0.85
    best_for    = full_generation architecture_review deep_refactor
    fitness     = 0.88
  }

  model "qwen2.5-coder:14b" {
    ollama_id   = qwen2.5-coder:14b
    vram_gb     = 12.0
    speed       = 0.55
    code_gen    = 0.96
    completion  = 0.93
    explanation = 0.94
    chat        = 0.92
    best_for    = complex_generation spec_writing full_review
    fitness     = 0.94
  }

  model "deepseek-coder-v2:16b" {
    ollama_id   = deepseek-coder-v2:16b
    vram_gb     = 14.0
    speed       = 0.45
    code_gen    = 0.97
    completion  = 0.94
    explanation = 0.95
    chat        = 0.90
    best_for    = large_generation architecture complex_refactor
    fitness     = 0.95
  }

  model "phi3.5:3.8b" {
    ollama_id   = phi3.5:3.8b
    vram_gb     = 3.5
    speed       = 0.88
    code_gen    = 0.78
    completion  = 0.80
    explanation = 0.85
    chat        = 0.88
    best_for    = explanation chat voice_response
    fitness     = 0.82
  }

  model "gemma3:4b" {
    ollama_id   = gemma3:4b
    vram_gb     = 3.8
    speed       = 0.85
    code_gen    = 0.76
    completion  = 0.78
    explanation = 0.84
    chat        = 0.90
    best_for    = chat explanation voice_response
    fitness     = 0.81
  }
}

// ── Domain 23 — Event Handlers ────────────────────────────────────────────────
domain "handlers"
on          = event_handler_declaration
when        = conditional_event_handler
before      = pre_event_hook
after       = post_event_hook
finally     = always_runs_handler
starts_with = string_prefix_match
contains    = string_contains_match
ends_with   = string_suffix_match
matches     = pattern_match
sorted_by   = collection_sort_operator
descending  = sort_direction_descending
ascending   = sort_direction_ascending

// ════════════════════════════════════════════════════════════════════════════
// NEXUS SYSTEM SPEC EXTENSION v1.2.0
// All primitives for Guardian + Nexus-Core + Idearium + Versionium
// ════════════════════════════════════════════════════════════════════════════

// ── Domain 24 — Network / Protocol ───────────────────────────────────────────
domain "network"
port        = network_port_binding
bind        = address_binding
protocol    = transport_protocol
http        = http_protocol
wss         = websocket_secure_protocol
sse         = server_sent_events_protocol
lan         = local_area_network_binding
route       = http_route_declaration
method      = http_method
endpoint    = api_endpoint
handshake   = connection_establishment_signal
register    = provider_registration_signal
heartbeat   = keepalive_signal
channel     = persistent_connection
open        = channel_open_signal
close       = channel_close_signal
ping        = health_check_signal
pong        = health_check_response
connect     = establish_connection
disconnect  = terminate_connection
reconnect   = re_establish_connection
middleware  = request_processing_layer
cors        = cross_origin_policy
auth        = authentication_gate
token       = authentication_token

// ── Domain 25 — JAA / Persistence ────────────────────────────────────────────
domain "jaa"
jaa         = json_append_array_store
table       = jaa_table_declaration
row         = jaa_row
insert      = jaa_insert_operation
update      = jaa_update_operation
delete      = jaa_delete_operation
query       = jaa_query_operation
get         = jaa_get_single
all         = jaa_get_all
where       = jaa_filter_clause
orderby     = jaa_sort_clause
limit       = jaa_limit_clause
hash        = content_hash
dedup       = deduplication_gate
schema      = row_schema_declaration
validate    = schema_validation_gate
migrate     = schema_migration
archive     = soft_delete_record
ledger      = append_only_event_log
artifact    = stored_binary_or_text_output
memory      = persistent_knowledge_store
crystal     = distilled_memory_pattern
seam_record = seam_verification_record
job         = queued_execution_unit
gap_record  = gap_table_entry
gap_question = gap_triggered_context_question
setting     = persistent_configuration_value
download    = detected_file_download

// ── Domain 26 — Agent / Provider ─────────────────────────────────────────────
domain "agent"
provider    = ai_provider_declaration
agent       = execution_agent
job_dispatch = route_job_to_provider
job_result  = agent_job_output
inject      = inject_text_into_provider_ui
submit      = submit_injected_text
dom_map     = dom_element_registry
dom_watch   = dom_mutation_observer
selector    = dom_css_selector
contenteditable = text_input_target
claim       = tab_ownership_signal
release     = tab_release_signal
tab         = browser_tab_agent
userscript  = browser_extension_script
pending     = job_awaiting_execution
generating  = job_in_progress
complete    = job_finished_signal
chunk       = streaming_response_unit
stable      = response_stability_signal
truncated   = incomplete_response_signal
verdict     = seam_evaluation_result

// ── Domain 27 — Memory / Cortex ───────────────────────────────────────────────
domain "memory"
ingest      = store_memory_record
search      = query_memory_store
forget      = soft_delete_memory
tier        = memory_tier_classification
hot         = active_memory_tier
warm        = recent_memory_tier
cold        = archived_memory_tier
forgotten   = deleted_memory_tier
index       = memory_search_index
cortex      = deep_memory_store
pattern     = detected_behavioral_pattern
distill     = compress_memory_to_crystal
recall      = retrieve_memory_record
context_build = assemble_agent_context
upload      = file_upload_signal
drag_drop   = file_drag_drop_signal
tag         = metadata_label
mime        = file_mime_type
size        = file_size_bytes

// ── Domain 28 — Idearium ──────────────────────────────────────────────────────
domain "idearium"
idea        = cognitive_unit
phase       = idea_lifecycle_phase
tension     = idea_pressure_score
link        = idea_relationship
spec_node   = idea_specification
gap_node    = idea_gap_record
seed        = idea_phase_seed
expanding   = idea_phase_expanding
tensioned   = idea_phase_tensioned
specced     = idea_phase_specced
building    = idea_phase_building
compartment = idea_compartment_label
resonance   = link_type_resonance
causal_link = link_type_causal
temporal_link = link_type_temporal
semantic_link = link_type_semantic
tension_engine = tension_calculation_system
gap_density = tension_component_gap_density
contradiction_score = tension_component_contradiction
novelty_score = tension_component_novelty

// ── Domain 29 — Versionium ────────────────────────────────────────────────────
domain "versionium"
version_chain = ordered_version_history
commit      = version_commit_record
branch      = version_branch
diff        = version_difference
merge       = version_merge_operation
rollback    = version_revert_operation
snapshot_version = point_in_time_version
semver      = semantic_version_string
changelog   = human_readable_version_notes
tag_version = version_tag_label

// ── Domain 30 — UI Interaction Contract ──────────────────────────────────────
domain "contract"
contract    = interface_boundary_declaration
hotswap     = live_component_replacement
projection  = cli_to_ui_projection
sync        = state_synchronization_signal
console_sync = console_to_chat_synchronization
live_tail   = real_time_log_stream
drag_zone   = file_drop_target
upload_zone = file_upload_target
page        = dedicated_record_view
tab_view    = tabbed_panel_view
dynamic     = runtime_rendered_content
fluid       = responsive_layout_signal

// ════════════════════════════════════════════════════════════════════════════
// NEXUS FULL SYSTEM SPEC EXTENSION v2.0.0
// Cortex + Cobalt + RAID + ORION + Forge + Versionium + Guardian bridge
// ════════════════════════════════════════════════════════════════════════════

// ── Domain 31 — Cobalt Core ───────────────────────────────────────────────────
domain "cobalt"
cobalt      = nexus_central_event_bus_and_registry
cobalt_bus  = pattern_matching_publish_subscribe_bus
cobalt_node = registered_module_in_cobalt_registry
cobalt_ledger = append_only_deduplicated_event_log
watchdog    = continuous_silence_detector
ring_buffer = last_N_events_circular_store
tick        = cobalt_bus_monotonic_event_counter
ingest      = publish_event_to_cobalt_bus
sealed      = immutable_after_construction
project     = cobalt_manifest_declaration
manifest    = module_identity_and_intent_declaration
heartbeat   = periodic_liveness_signal
pulse       = liveness_channel_broadcast

// ── Domain 32 — RAID ──────────────────────────────────────────────────────────
domain "raid"
raid        = routing_and_agent_intelligence_dispatcher
route       = select_agent_for_call
agent_call  = queued_inference_request
routed_to   = selected_agent_name
route_reason = routing_decision_explanation
local_first = ollama_before_cloud_law
claim       = atomic_ownership_of_agent_call
agent_priority = ordered_agent_preference_list

// ── Domain 33 — ORION ────────────────────────────────────────────────────────
domain "orion"
orion       = observation_record_and_inference_system
sensor      = bridge_message_accumulator
orion_session = accumulated_bridge_message_set
regime      = behavioral_classification
measure     = quantify_session_features
policy      = evaluate_session_against_rules
verify      = confirm_policy_verdict
buffering   = session_still_accumulating
measured    = session_feature_extraction_complete
evaluated   = policy_applied_to_session
verified    = verdict_confirmed
shape_sample = captured_behavioral_fingerprint
callto_id   = routing_identifier_for_session

// ── Domain 34 — Cortex (CLI + memory) ────────────────────────────────────────
domain "cortex"
cortex      = interactive_cli_and_memory_query_tool
cortex_memory = distilled_long_term_memory_store
memory_index = searchable_memory_index
recall      = retrieve_from_cortex_memory
forget      = soft_delete_memory_tier
conditioning_log = agent_conditioning_history
feedback_score = agent_response_quality_score
fix_map     = healer_resolution_record
bep_pattern = behavioral_encoding_pattern
active_trace = live_causal_execution_trace
agent_signature = agent_behavioral_fingerprint

// ── Domain 35 — Forge Engine ─────────────────────────────────────────────────
domain "forge_engine"
forge_module  = full_module_rewrite_operation
forge_patch   = minimal_targeted_patch_operation
forge_gate    = generate_siso_gate_function
forge_hook    = add_exported_function_with_uuid
patch_record  = forge_patch_audit_record
system_nucleus = ai_system_prompt_for_self_modification
constraint_field = structured_meaning_substrate
hook_uuid     = unique_hook_identifier
hook_comment  = uuid_annotation_on_symbol
forge_timeout = maximum_inference_duration_ms

// ── Domain 36 — Forge Pipeline ───────────────────────────────────────────────
domain "forge_pipeline"
pipeline    = ordered_node_graph_execution
pipeline_node = single_execution_unit_in_pipeline
node_type   = pipeline_node_category
trigger_node = pipeline_activation_node
condition_node = if_then_else_gate_node
transform_node = pure_data_transformation
api_call_node = http_fetch_execution_node
agent_call_node = guardian_inference_dispatch
store_node  = jaa_write_operation
emit_node   = siso_bus_event_emission
loop_node   = array_iteration_node
delay_node  = wait_n_milliseconds
seam_compile_node = run_seam_compiler
gap_node    = declare_gap_node
notify_node = toast_log_output_node
merge_node  = join_parallel_branches
fork_node   = parallel_branch_execution
pipeline_run = single_pipeline_execution_instance
arm         = enable_pipeline_scheduler
disarm      = disable_pipeline_scheduler
condition_evaluator = safe_expression_parser_no_eval

// ── Domain 37 — Seam Language ────────────────────────────────────────────────
domain "seam_lang"
seam_web    = constraint_language_type_system
ring1       = primitive_seam_type_layer
ring2       = composite_seam_type_layer
sealed_core = immutable_siso_jaa_foundation
web_path    = type_navigation_through_seam_web
bridge_keyword = non_adjacent_type_jump_resolver
web_type_violation = gap_for_invalid_web_path
seam_pass0  = tokenise_and_classify
seam_pass1  = build_constraint_field
seam_pass2  = resolve_gaps_and_bridges
seam_pass3  = emit_executable_js
seam_compile = run_all_seam_passes
seam_validate = check_seam_source_for_violations
nex_file    = bootable_sandbox_archive
nex_envelope = nex_file_header_with_sha256
shadow_layer = mutable_overlay_on_nex_sandbox
cos_compartment = container_operating_system_sandbox

// ── Domain 38 — Forge IDE ─────────────────────────────────────────────────────
domain "forge_ide"
forge_ide   = constraint_first_authoring_environment
spec_container = spec_file_that_instantiates_ide
spec_hook   = siso_bus_registration_from_spec
surface     = fs_watcher_registration_from_spec
gate_chain  = compiler_as_constraint_field_sequence
clip        = replayable_authoring_process_segment
gtci_loop   = gap_taxonomy_question_agent_fix_cycle
word_lattice = session_derived_shared_language_graph
prose_editor = block_based_contenteditable
code_editor = syntax_highlight_overlay_editor
field_pane  = constraint_field_gap_bep_display
preview_pane = html_field_spec_build_preview
console_pane = bus_event_stream_cli_repl
debug_overlay = per_component_isolation_4_states
null_bus    = isolated_component_event_sink
swirl_engine = van_gogh_flow_field_particle_system

// ── Domain 39 — Userscript Bridge ─────────────────────────────────────────────
domain "userscript"
browser_bridge = userscript_to_guardian_server_channel
dom_observer  = mutation_observer_wrapping_agent_ui
agent_tab     = claimed_browser_tab_for_job_execution
tab_discovery = find_or_open_agent_tab
tab_lock      = exclusive_tab_ownership_for_job
job_queue     = ordered_pending_job_list
queue_compartment = single_job_in_queue_with_state
detector      = sigma_delta_truncation_evaluator
sigma_detect  = response_distribution_divergence_check
delta_score   = weighted_diff_between_request_response
truncation_detect = incomplete_response_identifier
retry_protocol = failure_context_injection_for_retry
escalate_gap  = create_gap_record_after_max_retries
prompt_archaeology = streaming_token_behavioral_analysis
pa_session    = single_pa_measurement_window
burst_zone    = high_token_velocity_cluster
pause_zone    = inter_token_gap_above_threshold
waveform      = token_velocity_over_time_canvas

// ── Domain 40 — .spec Parser ────────────────────────────────────────────────
domain "spec_parser"
spec_file   = yaml_structured_specification_document
spec_block  = named_section_in_spec_file
spec_chunk  = parsed_deliverable_unit_of_spec
chunk_parser = split_spec_into_deliverable_chunks
split_on    = chunk_split_strategy_selector
heading_split = split_on_markdown_headings
divider_split = split_on_horizontal_rules
phase_split  = split_on_phase_or_step_markers
custom_split = split_on_user_defined_regex
chunk_profile = expected_response_characteristics_of_chunk
seam_contract = auto_generated_test_contract_for_chunk
chunk_verdict = pass_fail_result_from_agent_for_chunk
auto_inject  = automatic_sequential_chunk_delivery

// ── Domain 41 — Versionium ───────────────────────────────────────────────────
domain "versionium_full"
versionium  = content_addressable_version_control
versionium_commit = content_addressed_snapshot
versionium_branch = named_pointer_to_commit_chain
versionium_calendar = time_indexed_commit_history
versionium_file_index = file_path_to_object_hash_map
versionium_object = content_addressed_stored_object
file_refs   = named_reference_to_file_store_hash
file_store  = content_addressable_blob_storage
sha256      = content_hash_algorithm
fork_version = create_divergent_version_chain
rewind      = restore_to_prior_versionium_commit

// ════════════════════════════════════════════════════════════════════════════
// SPEC EXTENSION v2.1.0 — Cockpit + Guardian Extension + Siphon + Schema
// ════════════════════════════════════════════════════════════════════════════

domain "cockpit"
cockpit       = guardian_control_panel_ui
cockpit_mode  = operational_display_mode
deep_mode     = full_signal_display
fast_mode     = minimal_overhead_display
audit_mode    = expanded_signal_audit
creative_mode = creative_workflow_display
emergency_mode = command_only_display
silent_mode   = stream_and_command_only
panel         = named_display_region
topbar        = persistent_status_bar
sigma_ring    = live_sigma_score_indicator
compare_panel = dual_agent_comparison_panel
broadcast_mode = fire_same_prompt_to_multiple_agents
capture_panel = artifact_capture_display
event_viewer  = live_siso_bus_event_grouped_display
appid         = guardian_application_identity_token
session_token = guardian_session_authentication_token

domain "guardian_ext"
extension      = firefox_browser_extension
content_script = per_tab_injected_script
background_js  = extension_background_orchestrator
popup_js       = extension_popup_ui
cfr            = constraint_field_runtime
cesl           = canonical_execution_service_layer
rat            = reproducible_automation_trace
urck           = universal_runtime_constraint_kernel
ir_layer       = intent_routing_layer
callto         = routing_packet_to_agent
callto_state   = lifecycle_state_of_callto_packet
delivery_mode  = callto_delivery_guarantee_level
fire_and_forget = delivery_no_ack_required
at_least_once  = delivery_with_retry
exactly_once   = delivery_with_dedup
guarded_pipeline = delivery_with_full_verification
instance_id    = unique_extension_instance_identifier
automation_trace = cesl_deterministic_event_record

domain "siphon"
siphon         = server_side_chat_ingestion_module
pulse          = guardian_node_liveness_tracker
watchman       = guardian_health_monitor
chat_session   = normalized_captured_chat_session
chat_message   = individual_message_in_session
chat_completion = complete_agent_response_record
guardian_node  = registered_guardian_extension_instance
guardian_health = system_health_summary_record
health_score   = 0_to_1_guardian_health_metric
stale_node     = guardian_node_without_recent_heartbeat
siphon_ingest  = normalize_bridge_event_to_chat_table

domain "trust"
beta_distribution = bayesian_trust_model
alpha             = beta_pass_count
beta_param        = beta_fail_count
posterior_mean    = expected_trust_score
wilson_lower      = conservative_routing_weight
confidence_n      = total_observations
decay_halflife    = trust_score_decay_period
routing_weight    = raid_agent_selection_weight
cold_start_floor  = minimum_weight_for_new_source
snr_record        = single_gate_evaluation_record
trust_band        = categorical_trust_level
