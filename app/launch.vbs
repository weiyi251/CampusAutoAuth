Set ws = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
' 按 common install locations and PATH find node
node = ""
For Each c In Array("C:\Program Files\nodejs\node.exe", "C:\Program Files (x86)\nodejs\node.exe")
    If fso.FileExists(c) Then
        node = c
        Exit For
    End If
Next
If node = "" Then node = "node"
ws.CurrentDirectory = appDir
ws.Run """" & node & """ """ & appDir & "\server.js""", 0, False
