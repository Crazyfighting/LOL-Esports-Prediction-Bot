{ pkgs }: {
    deps = [
        pkgs.nodejs-18_x
        pkgs.nodePackages.typescript-language-server
        pkgs.yarn
        pkgs.replitPackages.jest
        pkgs.libuuid
        pkgs.pkg-config
        pkgs.cairo
        pkgs.pango
        pkgs.jpeg
        pkgs.glib
        pkgs.pixman
        pkgs.pngquant
        pkgs.librsvg
    ];
} 