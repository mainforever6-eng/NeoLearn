package com.max.neolang

import android.app.Activity
import android.content.ContentValues
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.annotation.RequiresApi
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.IOException

@InvokeArg
class SavePdfArgs {
  lateinit var fileName: String
  var mimeType: String = "application/pdf"
  var data: List<Int> = emptyList()
}

/**
 * Кладёт файл в общедоступную папку «Загрузки»/NeoLang.
 *
 * Начиная с Android 10 прямая запись в общие папки запрещена, поэтому файл
 * создаётся через MediaStore. На Android 8–9 используется обычная запись в
 * Downloads (если пользователь выдал разрешение на доступ к хранилищу).
 */
@TauriPlugin
class DownloadsPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun save(invoke: Invoke) {
    val args = invoke.parseArgs(SavePdfArgs::class.java)

    try {
      val bytes = ByteArray(args.data.size) { index -> args.data[index].toByte() }
      val path =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          saveWithMediaStore(bytes, args.fileName, args.mimeType)
        } else {
          saveLegacy(bytes, args.fileName, args.mimeType)
        }

      invoke.resolve(JSObject().put("path", path))
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Не удалось сохранить файл в «Загрузки»")
    }
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun saveWithMediaStore(bytes: ByteArray, fileName: String, mimeType: String): String {
    val resolver = activity.contentResolver
    val values =
      ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
        put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
        put(
          MediaStore.MediaColumns.RELATIVE_PATH,
          "${Environment.DIRECTORY_DOWNLOADS}/NeoLang",
        )
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }

    val uri =
      resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw IOException("Не удалось создать файл в «Загрузках»")

    try {
      val stream =
        resolver.openOutputStream(uri, "w")
          ?: throw IOException("Не удалось открыть файл в «Загрузках» для записи")
      stream.use { it.write(bytes) }

      values.clear()
      values.put(MediaStore.MediaColumns.IS_PENDING, 0)
      resolver.update(uri, values, null, null)
    } catch (error: Exception) {
      resolver.delete(uri, null, null)
      throw error
    }

    return "Загрузки/NeoLang/$fileName"
  }

  @Suppress("DEPRECATION")
  private fun saveLegacy(bytes: ByteArray, fileName: String, mimeType: String): String {
    val baseDir =
      Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    val dir = File(baseDir, "NeoLang")

    try {
      if (!dir.exists() && !dir.mkdirs()) {
        throw IOException("Не удалось создать папку «Загрузки»/NeoLang")
      }

      val file = uniqueFile(dir, fileName)
      file.writeBytes(bytes)
      MediaScannerConnection.scanFile(
        activity,
        arrayOf(file.absolutePath),
        arrayOf(mimeType),
        null,
      )
      return "Загрузки/NeoLang/${file.name}"
    } catch (error: SecurityException) {
      // Android 8–9 без разрешения на хранилище: используем папку приложения,
      // которую всё равно видно в файловых менеджерах этой версии Android.
      val fallbackDir =
        activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
          ?: throw IOException("Не удалось определить папку для сохранения", error)
      val fallback = uniqueFile(fallbackDir, fileName)
      fallback.writeBytes(bytes)
      return fallback.absolutePath
    }
  }

  private fun uniqueFile(dir: File, fileName: String): File {
    val dot = fileName.lastIndexOf('.')
    val base = if (dot > 0) fileName.substring(0, dot) else fileName
    val extension = if (dot > 0) fileName.substring(dot) else ""

    var candidate = File(dir, fileName)
    var index = 1
    while (candidate.exists()) {
      candidate = File(dir, "$base ($index)$extension")
      index += 1
    }
    return candidate
  }
}
