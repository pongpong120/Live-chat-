import java.io.File
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

val localProperties = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use(::load)
}

fun prop(name: String, default: String): String =
    providers.gradleProperty(name).orElse(localProperties.getProperty(name, default)).get()

android {
    namespace = "com.pingpong.voice"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.pingpong.rocket"
        minSdk = 24
        targetSdk = 36
        versionCode = 8
        versionName = "2.2.0"

        buildConfigField("String", "WEB_APP_URL", "\"${prop("WEB_APP_URL", "https://your-production-domain.example/").replace("\"", "\\\"")}\"")
        buildConfigField("boolean", "ALLOW_CLEARTEXT", prop("ALLOW_CLEARTEXT", "false"))
        manifestPlaceholders["allowCleartext"] = prop("ALLOW_CLEARTEXT", "false")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    signingConfigs {
        // Production release signing MUST come from CI/Railway/Build environment.
        // No keystore, password, or deterministic fallback secret is committed.
        create("release") {
            val storeFilePathEnv = providers.environmentVariable("PINGPONG_KEYSTORE_FILE").orNull
            val storePasswordEnv = providers.environmentVariable("PINGPONG_KEYSTORE_PASSWORD").orNull
            val keyAliasEnv = providers.environmentVariable("PINGPONG_KEY_ALIAS").orNull
            val keyPasswordEnv = providers.environmentVariable("PINGPONG_KEY_PASSWORD").orNull
            val hasRealSigningEnv = !storeFilePathEnv.isNullOrBlank() && !storePasswordEnv.isNullOrBlank() &&
                !keyAliasEnv.isNullOrBlank() && !keyPasswordEnv.isNullOrBlank()

            if (hasRealSigningEnv) {
                storeFile = file(storeFilePathEnv!!)
                storePassword = storePasswordEnv
                keyAlias = keyAliasEnv
                keyPassword = keyPasswordEnv
            } else {
                // BUG FIX (2026-09-28, Android APK production pass): android/README.md
                // and BUILD_TERMUX.md both already documented an "auto-generated local
                // dev keystore" fallback here, referencing keystore/LOCAL_KEYSTORE_README.md
                // — but that fallback never actually existed in this file. Since this
                // signingConfigs block is evaluated eagerly by Gradle/AGP for EVERY
                // variant (not lazily, only when assembleRelease actually runs), the old
                // unconditional `throw GradleException(...)` blocked `assembleDebug` too,
                // even though a debug build doesn't use this signing config at all. This
                // makes the already-documented behavior real: fall back to a clearly-
                // labeled, LOCAL-ONLY dev keystore instead of hard-failing the build.
                val localKeystoreDir = rootProject.file("keystore")
                val localKeystoreFile = File(localKeystoreDir, "pingpong-local-dev.jks")
                val localAlias = "pingpong-local-dev"
                val localPassword = "pingpong-local-dev"
                if (!localKeystoreFile.exists()) {
                    localKeystoreDir.mkdirs()
                    val javaHome = System.getenv("JAVA_HOME")
                    val keytool = if (!javaHome.isNullOrBlank()) "$javaHome/bin/keytool" else "keytool"
                    val result = project.exec {
                        commandLine(
                            keytool, "-genkeypair", "-v",
                            "-keystore", localKeystoreFile.absolutePath,
                            "-storetype", "PKCS12",
                            "-alias", localAlias,
                            "-keyalg", "RSA",
                            "-keysize", "2048",
                            "-validity", "10000",
                            "-storepass", localPassword,
                            "-keypass", localPassword,
                            "-dname", "CN=PingPong Local Dev, OU=Local, O=PingPong, C=IN"
                        )
                        isIgnoreExitValue = true
                    }
                    if (result.exitValue != 0) {
                        throw GradleException(
                            "Release signing is not configured (PINGPONG_KEYSTORE_FILE/PASSWORD/ALIAS/KEY_PASSWORD " +
                            "are unset) and auto-generating a local dev keystore also failed — is `keytool` " +
                            "(part of the JDK) installed and on PATH / JAVA_HOME set? Install a JDK, or set the " +
                            "four PINGPONG_KEYSTORE_* environment variables to use a real signing key."
                        )
                    }
                    File(localKeystoreDir, "LOCAL_KEYSTORE_README.md").writeText(
                        "# Local dev keystore\n\n" +
                        "`pingpong-local-dev.jks` was auto-generated by app/build.gradle.kts because " +
                        "PINGPONG_KEYSTORE_FILE/PASSWORD/ALIAS/KEY_PASSWORD were not set in the environment. " +
                        "It exists only so `assembleDebug`/`assembleRelease` can produce an installable, " +
                        "validly-signed APK for your own device testing without any manual signing setup.\n\n" +
                        "**This is NOT your Play Store upload key.** Certificate CN is `PingPong Local Dev` " +
                        "so it's always identifiable via `apksigner verify --print-certs`. Do not distribute " +
                        "an APK signed with it beyond your own testing, and do not upload it to Play Console.\n\n" +
                        "For a real release, generate a real key with `scripts/create-release-keystore.sh` " +
                        "and set the four PINGPONG_KEYSTORE_* environment variables before building — once " +
                        "those are set, this fallback is skipped entirely and your real key is used instead.\n"
                    )
                }
                storeFile = localKeystoreFile
                storePassword = localPassword
                keyAlias = localAlias
                keyPassword = localPassword
            }
        }
    }

    buildTypes {
        debug {
            versionNameSuffix = "-debug"
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("release")
        }
    }

    packaging {
        resources {
            excludes += setOf("META-INF/NOTICE.md", "META-INF/LICENSE.md", "META-INF/LICENSE-notice.md")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
}
