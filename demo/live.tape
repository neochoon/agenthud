# AgentHUD live monitor demo.
# Generates: demo/live.gif
#
# To regenerate:
#   vhs demo/live.tape
#
# Shows: launching the TUI, navigating the project tree, toggling the
# help overlay, focusing the activity viewer, opening detail view on a
# past tool call, jumping back to the live edge, turning on tracking
# (the [LIVE …] spinner), and quitting (which restores the pre-launch
# shell via alt-screen).

Output demo/live.gif

Set FontSize 16
Set Width 1400
Set Height 800
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms

# Pre-launch shell prompt visible
Sleep 800ms

Type "agenthud"
Enter
Sleep 2500ms

# Browse the project tree
Type "j"
Sleep 700ms
Type "j"
Sleep 700ms
Type "j"
Sleep 700ms
Type "j"
Sleep 700ms
Type "j"
Sleep 700ms
Type "j"
Sleep 700ms
Type "j"
Sleep 700ms
Type "j"
Sleep 800ms

# Switch focus to the activity viewer
Tab
Sleep 1200ms

# Scroll backward through history — lands a few entries back where
# the cursor is more likely on a rich tool call (edit/bash/commit)
# than on a plain response.
Type "k"
Sleep 400ms
Type "k"
Sleep 400ms
Type "k"
Sleep 400ms
Type "k"
Sleep 600ms

# Open the detail view for the selected activity (tool call body,
# edit diff, bash output, …). Escape collapses it back to the viewer.
Enter
Sleep 3500ms
Escape
Sleep 600ms

# Jump back to the live edge (newest at bottom; the sliding "›" reappears)
Type "G"
Sleep 1200ms

# Turn tracking on — the tree title bar gains a "[LIVE …]" spinner and,
# if a hot sub-agent is around, the selection follows it automatically.
Type "t"
Sleep 2500ms

# Quit. Alt-screen exits cleanly — viewers see the pre-launch shell return.
Type "q"
Sleep 1500ms
