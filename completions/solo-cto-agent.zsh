#compdef solo-cto-agent
# Zsh completion for solo-cto-agent
# Install: source <(solo-cto-agent --completions zsh)
# Or: solo-cto-agent --completions zsh > ~/.zsh/completions/_solo-cto-agent

_solo-cto-agent() {
  local -a commands
  commands=(
    'init:Install skills to ~/.claude/skills/'
    'setup-pipeline:Create orchestrator repo + install workflows'
    'setup-repo:Install workflows to a single product repo'
    'upgrade:Upgrade Builder to CTO tier'
    'sync:Fetch CI/CD results from GitHub'
    'review:Local code review via Claude API'
    'dual-review:Dual-agent cross-review (Claude + OpenAI)'
    'knowledge:Extract session decisions into knowledge articles'
    'session:Save/restore/list session context'
    'status:Check skill health and sync status'
    'lint:Check skill files for size and structure issues'
    'doctor:Complete system health check'
    'notify:Send event-tagged notification'
    'telegram:Telegram notification setup'
  )

  _arguments -C \
    '--help[Show help]' \
    '--version[Show version]' \
    '-V[Show version]' \
    '--lang[Set locale]:lang:(en ko)' \
    '--completions[Output shell completions]:shell:(bash zsh)' \
    '1:command:->cmds' \
    '*::arg:->args'

  case $state in
    cmds)
      _describe -t commands 'solo-cto-agent command' commands
      ;;
    args)
      case $words[1] in
        init)
          _arguments \
            '--force[Overwrite existing skills]' \
            '--preset[Tier preset]:preset:(maker builder cto)' \
            '--wizard[Run interactive wizard]'
          ;;
        setup-pipeline|setup-repo|upgrade|sync)
          _arguments \
            '--org[GitHub org]:org:' \
            '--tier[Tier level]:tier:(maker builder cto)' \
            '--repos[Comma-separated repos]:repos:' \
            '--apply[Apply changes (sync only)]'
          ;;
        review)
          _arguments \
            '--staged[Review staged changes]' \
            '--branch[Review branch diff]' \
            '--file[Review specific file]:file:_files' \
            '--target[Base branch]:branch:' \
            '--dry-run[Preview without API call]' \
            '--solo[Force single-agent mode]' \
            '--json[Output as JSON]' \
            '--markdown[Output as Markdown]'
          ;;
        dual-review)
          _arguments \
            '--staged[Review staged changes]' \
            '--branch[Review branch diff]' \
            '--target[Base branch]:branch:'
          ;;
        knowledge)
          _arguments \
            '--session[Capture from session]' \
            '--file[Capture from file]:file:_files' \
            '--manual[Manual input]' \
            '--project[Project tag]:project:'
          ;;
        session)
          _arguments '1:action:(save restore list)' \
            '--project[Project tag]:project:' \
            '--session[Session file]:file:_files' \
            '--limit[Max results]:limit:'
          ;;
        notify)
          _arguments '1:event:(deploy-ready deploy-error)' \
            '--target[Deploy target]:target:' \
            '--url[Deploy URL]:url:' \
            '--commit[Commit SHA]:commit:' \
            '--body[Message body]:body:'
          ;;
        telegram)
          _arguments '1:action:(wizard)' \
            '--lang[Language]:lang:(en ko)'
          ;;
        lint)
          _arguments '1:path:_files'
          ;;
      esac
      ;;
  esac
}

_solo-cto-agent "$@"
