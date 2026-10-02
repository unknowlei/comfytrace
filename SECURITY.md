# Security

ComfyTrace treats workflow JSON and PNG metadata as untrusted input. The browser
application has no backend and does not send imported files over the network.
Reports are not automatically anonymized and should be reviewed before sharing.

Please report input-triggered code execution, file disclosure or unexpected
network transmission through a private GitHub security report when available.
Do not attach real credentials or private workflows to public issues.

Supported release line: 1.x. There is no guarantee that a statically valid workflow
can run safely or successfully in ComfyUI; that depends on plugins and runtime.
