import java.io.File
import java.io.FileInputStream
import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// ---------------------------------------------------------------------------
// Release signing.
//
// Credentials are read from <android-root>/keystore.properties (git-ignored):
//
//   storeFile=/absolute/or/relative/path/to/upload-keystore.jks
//   storePassword=...
//   keyAlias=upload
//   keyPassword=...          # optional, defaults to storePassword
//
// If the file is missing, debug builds keep working and the release build is
// left unsigned (a warning is printed for release tasks).
// ---------------------------------------------------------------------------
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        FileInputStream(keystorePropertiesFile).use { load(it) }
    }
}

fun keystoreProperty(name: String, fallback: String? = null): String =
    keystoreProperties.getProperty(name)?.takeIf { it.isNotBlank() }
        ?: fallback?.takeIf { it.isNotBlank() }
        ?: throw GradleException(
            "Missing property '$name' in ${keystorePropertiesFile.absolutePath}"
        )

val releaseStoreFile: File? = if (keystorePropertiesFile.exists()) {
    val configuredPath = keystoreProperty("storeFile")
    val candidate = File(configuredPath).let { if (it.isAbsolute) it else rootProject.file(configuredPath) }
    if (!candidate.isFile) {
        throw GradleException(
            "Keystore file '${candidate.absolutePath}' referenced by " +
                "'${keystorePropertiesFile.absolutePath}' does not exist."
        )
    }
    candidate
} else {
    val buildingRelease = gradle.startParameter.taskNames.any {
        it.contains("release", ignoreCase = true)
    }
    if (buildingRelease) {
        logger.warn(
            "keystore.properties not found at ${keystorePropertiesFile.absolutePath}: " +
                "the release build will be unsigned."
        )
    }
    null
}

android {
    compileSdk = 37
    namespace = "com.max.neolang"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.max.neolang"
        minSdk = 26
        targetSdk = 37
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        releaseStoreFile?.let { keystoreFile ->
            val storePasswordValue = keystoreProperty(
                "storePassword",
                keystoreProperties.getProperty("password"),
            )
            create("release") {
                storeFile = keystoreFile
                storePassword = storePasswordValue
                keyAlias = keystoreProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                    ?.takeIf { it.isNotBlank() }
                    ?: storePasswordValue
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfig = signingConfigs.findByName("release")
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
