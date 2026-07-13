' Runs a .cmd file with its arguments completely hidden (no console window flash),
' so Task Scheduler entries stop popping up cmd windows on the desktop.
' Usage: wscript.exe run-hidden.vbs "C:\path\to\scan.cmd" [arg1] [arg2] ...
Dim objShell, cmdLine, i

Set objShell = CreateObject("WScript.Shell")

cmdLine = """" & WScript.Arguments(0) & """"
For i = 1 To WScript.Arguments.Count - 1
    cmdLine = cmdLine & " " & WScript.Arguments(i)
Next

objShell.Run cmdLine, 0, True
