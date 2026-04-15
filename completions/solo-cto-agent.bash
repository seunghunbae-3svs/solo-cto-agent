#!/usr/bin/env bash
# Bash completion for solo-cto-agent
# Install: source <(solo-cto-agent --completions bash)
# Or: solo-cto-agent --completions bash >> ~/.bashrc

_solo_cto_agent() {
  local cur prev commands subcommands
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"

  commands="init setup-pipeline setup-repo upgrade sync review dual-review deep-review knowledge session status lint doctor notify telegram routine --help --version --lang --completions"

  case "$prev" in
    solo-cto-agent)
      COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
      return 0
      ;;
    init)
      COMPREPLY=( $(compgen -W "--force --preset --wizard" -- "$cur") )
      return 0
      ;;
    --preset)
      COMPREPLY=( $(compgen -W "maker builder cto" -- "$cur") )
      return 0
      ;;
    setup-pipeline|setup-repo|upgrade|sync)
      COMPREPLY=( $(compgen -W "--org --tier --repos --apply" -- "$cur") )
      return 0
      ;;
    --tier)
      COMPREPLY=( $(compgen -W "maker builder cto" -- "$cur") )
      return 0
      ;;
    review)
      COMPREPLY=( $(compgen -W "--staged --branch --file --target --dry-run --solo --json --markdown" -- "$cur") )
      return 0
      ;;
    dual-review)
      COMPREPLY=( $(compgen -W "--staged --branch --target" -- "$cur") )
      return 0
      ;;
    knowledge)
      COMPREPLY=( $(compgen -W "--session --file --manual --project" -- "$cur") )
      return 0
      ;;
    session)
      COMPREPLY=( $(compgen -W "save restore list --project --session --limit" -- "$cur") )
      return 0
      ;;
    notify)
      COMPREPLY=( $(compgen -W "deploy-ready deploy-error" -- "$cur") )
      return 0
      ;;
    deploy-ready)
      COMPREPLY=( $(compgen -W "--target --url --commit --body" -- "$cur") )
      return 0
      ;;
    deploy-error)
      COMPREPLY=( $(compgen -W "--target --commit --body" -- "$cur") )
      return 0
      ;;
    deep-review)
      COMPREPLY=( $(compgen -W "--staged --branch --file --target --dry-run --json --force" -- "$cur") )
      return 0
      ;;
    routine)
      COMPREPLY=( $(compgen -W "fire schedules" -- "$cur") )
      return 0
      ;;
    fire)
      COMPREPLY=( $(compgen -W "--trigger --text --dry-run --force" -- "$cur") )
      return 0
      ;;
    schedules)
      COMPREPLY=( $(compgen -W "--json" -- "$cur") )
      return 0
      ;;
    telegram)
      COMPREPLY=( $(compgen -W "wizard" -- "$cur") )
      return 0
      ;;
    --lang)
      COMPREPLY=( $(compgen -W "en ko" -- "$cur") )
      return 0
      ;;
    --completions)
      COMPREPLY=( $(compgen -W "bash zsh" -- "$cur") )
      return 0
      ;;
    lint|--file)
      COMPREPLY=( $(compgen -f -- "$cur") )
      return 0
      ;;
  esac

  COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
}

complete -F _solo_cto_agent solo-cto-agent
