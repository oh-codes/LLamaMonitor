//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// hideConsole stops nvidia-smi (a console app) from flashing a window when the
// host itself is a windowless GUI binary.
func hideConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}
