{
  description = "migitoji — 縦組み・見開き対応の組式カスタマイズ型電子書籍リーダー (foliate-js submodule)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # リポジトリ内では submodule として参照するが、
    # Nix の flake ソースは submodule 内容を含まないため、
    # パッケージビルド用に入力としても取得する。
    foliate-js = {
      url = "github:johnfactotum/foliate-js";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, foliate-js }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = pkgsFor system;
          node = pkgs.nodejs_22;
          serve = pkgs.writeShellApplication {
            name = "migitoji-serve";
            runtimeInputs = [ node ];
            text = ''
              exec node "''${MIGITOJI_ROOT:-$(pwd)}/scripts/serve.mjs" "$@"
            '';
          };
        in
        {
          default = pkgs.mkShell {
            name = "migitoji";
            packages = [
              node
              pkgs.git
              pkgs.curl
              pkgs.zip
              pkgs.nixpkgs-fmt
            ];
            shellHook = ''
              echo "migitoji devshell  (node $(node --version))"
              echo "  npm run dev        # 開発サーバー http://127.0.0.1:8000/"
              echo "  npm test           # 組式スキーマ/CSS 生成の単体テスト"
              echo "  npm run build      # dist/ を生成 (GitHub Pages 用)"
              echo "  npm run gen:presets"
              echo "  npm run smoke      # Firefox (BiDi) で実描画スモークテスト"
              echo "  migitoji-serve     # 依存ゼロの静的配信サーバー"
            '';
            # サブモジュールを再帰的に取得するためのヒント
            GIT_SUBMODULE_STRATEGY = "recursive";
          };
        });

      apps = forAllSystems (system:
        let pkgs = pkgsFor system; in
        {
          default = {
            type = "app";
            program = "${pkgs.writeShellApplication {
              name = "migitoji-dev";
              runtimeInputs = [ pkgs.nodejs_22 ];
              text = ''exec node "''${MIGITOJI_ROOT:-$(pwd)}/scripts/serve.mjs" "$@"'';
            }}/bin/migitoji-dev";
          };
        });

      packages = forAllSystems (system:
        let pkgs = pkgsFor system; in
        {
          default = pkgs.stdenvNoCC.mkDerivation {
            pname = "migitoji";
            version = "0.1.0";
            src = self;
            nativeBuildInputs = [ pkgs.nodejs_22 ];
            buildPhase = ''
              runHook preBuild
              # flake ソースに submodule 内容が含まれないため入力を展開する
              rm -rf vendor/foliate-js
              mkdir -p vendor
              cp -r ${foliate-js} vendor/foliate-js
              chmod -R u+w vendor/foliate-js
              node scripts/build.mjs --out dist
              runHook postBuild
            '';
            installPhase = ''
              runHook preInstall
              mkdir -p $out/share/migitoji
              cp -r dist/. $out/share/migitoji/
              runHook postInstall
            '';
          };
        });
    };
}
