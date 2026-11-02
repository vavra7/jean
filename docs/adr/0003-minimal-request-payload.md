# Minimal request payload, no context trimming

Status: accepted

Requests send only `model`, `messages`, and `stream`. No sampling parameters, no per-model capability registry, and no context-window bookkeeping. NVIDIA NIM validates request bodies with `additionalProperties: false` per model, so any optional parameter is a per-model 400/422 waiting to happen; sending nothing optional sidesteps the entire class. Without a `context_window` on models there is also nothing to trim against, so long threads fail with the provider's own error, which we propagate verbatim. This is a deliberate deviation: a future reader will want to add trimming and temperature. Adding either requires a real model-metadata source, which NIM's `/v1/models` does not provide.
