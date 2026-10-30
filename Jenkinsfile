pipeline {
  agent { label 'linux' }

  options {
    timestamps()
    disableConcurrentBuilds()
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

    stage('Validate build source') {
      steps {
        script {
          if (env.CHANGE_ID?.trim()) {
            // Only PRs originating in this repository are eligible on the shared agent.
            // Forks must use an isolated runner. Jenkinsfile changes still require review.
            if (env.CHANGE_FORK?.trim()) {
              error('Fork pull requests are not allowed on the shared Jenkins agent.')
            }
            if (env.CHANGE_TARGET != 'main') {
              error('Only pull requests targeting main are allowed on this agent.')
            }
            if (!env.CHANGE_BRANCH?.trim()) {
              error('Cannot verify pull request source branch; refusing shared-agent build.')
            }
          }
        }
        sh '''
          set -eu
          git rev-parse HEAD
          mise --version
        '''
      }
    }

<<<<<<< HEAD
    stage('Prepare PR merge test') {
      when { changeRequest target: 'main' }
=======
    stage('Validate AI skills') {
      steps {
        sh 'mise exec node@24 -- node scripts/validate-ai-skills.mjs'
      }
    }

    stage('Quality / Node 20.19.0') {
>>>>>>> origin/main
      steps {
        sh '''
          set -eu
          # Jenkins checks out the PR head. Test the prospective merge with main,
          # while keeping HEAD at the PR commit for the GitHub status context.
          git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
          git -c user.name='PipeX CI' -c user.email='ci@localhost' merge --no-commit --no-ff origin/main
          echo 'PR working tree now contains the proposed merge with main.'
        '''
      }
    }

    stage('Quality / Node 26') {
      steps {
        sh '''
          set -eu
          mise exec node@26 -- bash -c '
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
      when { not { changeRequest() } }
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
          mise exec node@24 -- npm exec -- node scripts/verify-packed-consumer.mjs
        '''
        archiveArtifacts artifacts: '.artifacts/*.tgz,dist/**', fingerprint: true
      }
    }
  }

  post {
    cleanup {
      script {
        if (getContext(hudson.FilePath)) {
          deleteDir()
        } else {
          echo 'Skipping workspace cleanup: no workspace context available.'
        }
      }
    }
  }
}
