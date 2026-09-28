const fs = require('fs');
const path = 'src/hooks/useSystemDiagnostics.js';
let code = fs.readFileSync(path, 'utf8');

if (!code.includes('useRef')) {
    code = code.replace("import { useState, useEffect, useCallback, useTransition } from 'react';", "import { useState, useEffect, useCallback, useTransition, useRef } from 'react';");
    fs.writeFileSync(path, code);
    console.log("Import patched");
}
