'use strict'

const LIMIT_CONCURRENT_FILES = 100

const async = require('async')
const globby = require('globby')
const _ = require('lodash')

const awsClient = require('../lib/aws-client')
const awsInvalidationParameters = require('../lib/aws-invalidation-parameters')
const log = require('../lib/output')

const uploadDirectory = (
  directoryPath,
  credentials,
  options,
  invalidation,
  filesOptions
) => {
  awsClient.init({credentials, options})

  const s3 = awsClient.S3()

  log.info(`[fs] Reading directory...`)

  return new Promise((resolve, reject) => {
    globby([`${directoryPath}/**/*`], {onlyFiles: true})
      .then(files => {
        const filesToInvalidate = []
        const basePath = options.basePath
          ? addTrailingS3Sep(options.basePath)
          : ''
        const filesToUpload = files
          .map(file => file.replace(`${directoryPath}/`, ''))
          .filter(file => {
            if (options.exclude && testRule(options.exclude, file)) {
              return false
            }

            if (
              !options.include ||
              (options.include && testRule(options.include, file))
            ) {
              filesToInvalidate.push(addHeadingS3Sep(basePath + file))

              return true
            }

            return false
          })

        log.info(`[fs] Got ${filesToUpload.length} files to upload\n`)
        log.info(`[network] Upload ${filesToUpload.length} files...`)

        const progressBar = s3.setupProgressBar(files)
        const fileCount = files.length

        return async
          .mapLimit(
            filesToUpload,
            LIMIT_CONCURRENT_FILES,
            s3.uploadFile({
              directoryPath,
              options,
              filesOptions,
              fileCount,
              progressBar
            })
          )
          .then(filesUploaded => {
            log.progress('> All files uploaded successfully!', true)
            log.info(
              `\n[result] URLs of uploaded files\n${filesUploaded.join('\n')}`
            )

            if (
              awsInvalidationParameters.checkInvalidationConfig({
                invalidation
              }) ||
              (invalidation &&
                invalidation.awsDistributionId &&
                invalidation.awsInvalidationPath &&
                invalidation.awsInvalidationPath === 'auto' &&
                filesToInvalidate.length > 0)
            ) {
              const cloudfront = awsClient.CloudFront()

              cloudfront
                .createInvalidation({
                  distribution: invalidation.awsDistributionId,
                  paths:
                    invalidation.awsInvalidationPath === 'auto'
                      ? filesToInvalidate
                      : invalidation.awsInvalidationPath
                })
                .then(result => {
                  log.info(
                    `\n[result] Cloudfront invalidation created: ${result &&
                      result.Invalidation &&
                      result.Invalidation.Id}`
                  )
                  resolve()
                })
                .catch(err => {
                  log.error(err, true)
                  reject(err)
                })
            } else {
              resolve()
            }
          })
          .catch(err => {
            if (err) {
              log.error(err, true)
              reject(err)
            }
          })
      })
      .catch(_ => {
        const errorMsg = `Cannot read directory ${directoryPath} or doesn't exist`
        log.error(errorMsg, true)
        reject(new Error(errorMsg))
      })
  })
}

const addHeadingS3Sep = fPath => {
  return fPath && !fPath.startsWith('/') ? '/' + fPath : fPath
}

const addTrailingS3Sep = fPath => {
  return fPath ? fPath.replace(/\/?(\?|#|$)/, '/$1') : fPath
}

const testRule = (rule, subject) => {
  if (_.isRegExp(rule)) {
    return rule.test(subject)
  } else if (_.isFunction(rule)) {
    return !!rule(subject)
  } else if (_.isArray(rule)) {
    return _.every(rule, condition => testRule(condition, subject))
  } else if (_.isString(rule)) {
    return new RegExp(rule).test(subject)
  } else {
    throw new Error('Invalid include / exclude rule')
  }
}

module.exports = uploadDirectory
