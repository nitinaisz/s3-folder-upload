'use strict'

const fs = require('fs')
const path = require('path')

const getContentEncoding = require('./get-content-encoding')
const getDirectoryPrefix = require('./get-directory-prefix')
const getFileExtension = require('./get-file-extension')
const ProgressBar = require('progress')
const mime = require('mime')

const DEFAULT_ACL = 'public-read'
const CACHE_CONTROL = 'public, max-age=31536000'
const EXPIRES = 31536000 // 1 year

const init = ({awsS3, bucket}) => ({
  uploadFile: uploadFile({awsS3, bucket}),
  setupProgressBar: setupProgressBar
})

const setupProgressBar = files => {
  const progressTotal = files.length

  return new ProgressBar('Uploading [:bar] :percent :etas', {
    total: progressTotal
  })
}

const addTrailingS3Sep = fPath => {
  return fPath ? fPath.replace(/\/?(\?|#|$)/, '/$1') : fPath
}

const uploadFile = ({awsS3, bucket, fileCount, progressBar}) => ({
  directoryPath,
  options = {},
  filesOptions = {},
  progressBar
} = {}) => {
  return (file, done) => {
    const filePath = path.resolve(directoryPath, file)
    const fileBuffer = fs.readFileSync(filePath)
    let fileExtension = getFileExtension(file)

    const contentEncoding = getContentEncoding(fileExtension)
    fileExtension = contentEncoding
      ? getFileExtension(file, {previous: true})
      : fileExtension

    const metaData = mime.getType(fileExtension)
    // log.progress(`Uploading ${file}...`)

    const onUpload = (err, data) => {
      if (err) {
        done(err)
      } else {
        // log.progress(`Uploaded ${file}...`);
        progressBar.tick()
        done(null, data.Location)
      }
    }

    const fileOptions = Object.assign({}, options, filesOptions[file])

    const uploadKey = fileOptions.useFoldersForFileTypes
      ? `${getDirectoryPrefix(fileExtension)}/${file}`
      : file

    const basePath = fileOptions.basePath
      ? addTrailingS3Sep(fileOptions.basePath)
      : ''

    const key =
      basePath +
      (fileOptions.uploadFolder
        ? `${fileOptions.uploadFolder}/${uploadKey}`
        : uploadKey)

    const uploadConfig = {
      ACL: fileOptions.ACL || DEFAULT_ACL,
      Body: fileBuffer,
      Bucket: bucket,
      CacheControl: fileOptions.CacheControl || CACHE_CONTROL,
      ContentEncoding: contentEncoding,
      ContentType: metaData,
      Expires: fileOptions.Expires || EXPIRES,
      Key: key
    }

    awsS3.upload(uploadConfig, onUpload)
  }
}

module.exports = init
