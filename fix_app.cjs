const fs = require('fs');
let code = fs.readFileSync('src/App.jsx', 'utf8');
code = code.replace("import StrategyConsultantTerminal from './components/planner/StrategyConsultantTerminal';", "import StrategyConsultantTerminal from './components/planner/StrategyConsultantTerminal.jsx';");
fs.writeFileSync('src/App.jsx', code);
