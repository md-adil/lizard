var gulp = require('gulp');
const sass = require('gulp-sass');
const sourcemaps = require('gulp-sourcemaps');
var electron = require('electron-connect').server.create();
 
gulp.task('serve', function () {
 
  // Start browser process 
  electron.start();

  // Restart browser process 
  gulp.watch(['main/**/*.js'], electron.restart);
 
  // Reload renderer process 
  gulp.watch(['app/**/*', 'assets/**/*', 'views/**/*'], electron.reload);
});

gulp.task('sass', () => {
	gulp.src('assets/sass/**/*.scss')
    .pipe(sourcemaps.init())
		.pipe(sass())
    .pipe(sourcemaps.write())
		.pipe(gulp.dest('assets/css'));
});

gulp.task('watch', ['serve'], function() {
	gulp.watch('assets/sass/**/*.scss', ['sass'], electron.reload);
});

gulp.task('run', function() {
	electron.start();
});