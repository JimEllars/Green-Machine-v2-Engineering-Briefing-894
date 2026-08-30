with open("src/hooks/useSystemDiagnostics.js", "r") as f:
    content = f.read()

content = content.replace("} catch (e) {}", "} catch (e) { /* ignore */ }")

with open("src/hooks/useSystemDiagnostics.js", "w") as f:
    f.write(content)
