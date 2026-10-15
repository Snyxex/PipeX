pipeline {
  agent { label 'linux' }

  options {
    timestamps()
    disableConcurrentBuilds(abortPrevious: true)
    timeout(time: 45, unit: 'MINUTES')
    skipDefaultCheckout(true)
    buildDiscarder(logRotator(numToKeepStr: '20', artifactDaysToKeepStr: '7'))
  }

  environment {
    CI = 'true'
    NPM_CONFIG_CACHE = "${WORKSPACE}/.npm"
    MISE_YES = '1'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Trusted branch check') {
      steps {
        script {
          if (env.CHANGE_ID?.trim() || env.CHANGE_FORK?.trim()) {
            error('PipeX CI runs only for trusted branches on this shared host agent; pull requests require an isolated agent.')
          }
        }
        sh '''
          set -eu
          git rev-parse HEAD
          mise --version
        '''
      }
    }

    stage('Quality / Node 20.19.0') {
      steps {
        sh '''
          set -eu
          mise exec node@20.19.0 -- bash -c '
            set -eu
            node --version
            npm --version
            npm ci --ignore-scripts --no-audit --no-fund
            npm run quality:ci
          '
        '''
      }
    }

    stage('Quality / Node 22') {
      steps {
        sh '''
          set -eu
          mise exec node@22 -- bash -c '
            set -eu
            node --version
            npm --version
            npm ci --ignore-scripts --no-audit --no-fund
            npm run quality:ci
          '
        '''
      }
    }

    stage('Quality / Node 24') {
      steps {
        sh '''
          set -eu
          mise exec node@24 -- bash -c '
            set -eu
            node --version
            npm --version
            npm ci --ignore-scripts --no-audit --no-fund
            npm run quality:ci
          '
        '''
      }
    }

    stage('Dependency audit') {
      steps {
        sh 'mise exec node@24 -- npm audit --audit-level=high'
      }
    }

    stage('GitHub dependency consumer') {
      options {
        timeout(time: 10, unit: 'MINUTES')
      }
      steps {
        sh '''
          set -eu
          REF="$(git rev-parse HEAD)"
          case "$REF" in
            *[!0-9a-f]*|'') echo "Invalid commit SHA" >&2; exit 2 ;;
          esac
          test "${#REF}" -eq 40
          export PIPEX_GITHUB_INSTALL_SPEC="github:Snyxex/PipeX#$REF"
          mise exec node@24 -- npm run test:consumer:github
        '''
      }
    }

    stage('Archive package') {
      steps {
        sh '''
          set -eu
          mkdir -p .artifacts
          mise exec node@24 -- npm pack --ignore-scripts --pack-destination .artifacts
          test -f dist/index.mjs
          test -f dist/index.d.mts
        '''
        archiveArtifacts artifacts: '.artifacts/*.tgz,dist/**', fingerprint: true
      }
    }
  }

  post {
    always {
      deleteDir()
    }
  }
}
